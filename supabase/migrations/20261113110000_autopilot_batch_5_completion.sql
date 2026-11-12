-- Autopilot batch 5 completion: AP-047, 062, 063, 078, 080 and 085.
-- The initial four-feature batch file was applied on 13 November 2026; do not rewrite it.
-- This additive migration depends on 20261112200000 and is independent of the concurrent quotation review fixes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- AP-047: retain the canonical inventory ledger; large corrections need a second person.
create table public.stock_adjustment_policies (
  company_id uuid primary key references public.companies(id), threshold numeric(14,3) not null check(threshold>=0),
  reason text not null, updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp()
);
create table public.stock_adjustment_requests (
  id uuid primary key, company_id uuid not null references public.companies(id), item_id uuid not null references public.inventory_items(id),
  direction text not null check(direction in ('in','out')), quantity numeric(14,3) not null check(quantity>0), expected_stock numeric(14,3) not null check(expected_stock>=0),
  reason text not null, status text not null check(status in ('requested','posted','rejected','stale')),
  requested_by uuid not null references public.app_users(id), requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.app_users(id), decided_at timestamptz, decision_reason text, movement_id uuid references public.inventory_movements(id),
  fingerprint text not null, check(status<>'posted' or movement_id is not null)
);
create index stock_adjustment_requests_company_idx on public.stock_adjustment_requests(company_id,status,requested_at,id);
create unique index stock_adjustment_requests_pending on public.stock_adjustment_requests(company_id,item_id) where status='requested';

-- Supplemental quantity journal for stock families whose canonical movements use different tables.
-- Baselines identify the migration boundary honestly; all subsequent deltas are retained atomically.
create table public.stock_quantity_events (
  id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
  source_table text not null, source_id uuid not null, field text not null, kind text not null check(kind in ('baseline','receipt','issue','adjustment_in','adjustment_out')),
  before_qty numeric, after_qty numeric, delta numeric not null, actor_id uuid, recorded_at timestamptz not null default clock_timestamp(), evidence jsonb not null
);
create index stock_quantity_events_company_idx on public.stock_quantity_events(company_id,source_table,source_id,id);

create function private.ap5_guard_quantity() returns trigger language plpgsql set search_path=public,private as $$
declare k text; a jsonb:=to_jsonb(old); b jsonb:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
begin
  if current_user in ('authenticated','anon') then
    if tg_op='DELETE' then raise exception 'AP: Stock records are retained; use the stock workflow.' using errcode='42501'; end if;
    foreach k in array tg_argv loop
      if a->k is distinct from b->k then raise exception 'AP: Quantities change only through receipts, issues, transfers or approved adjustments.' using errcode='42501'; end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.ap5_guard_quantity() from public,anon,authenticated;
create function private.ap5_journal_quantity() returns trigger language plpgsql security definer set search_path=public,private as $$
declare k text; a jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  b jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; prev numeric; next numeric; d numeric;
begin
  foreach k in array tg_argv loop
    prev:=case when tg_op='INSERT' then null else (a->>k)::numeric end;
    next:=case when tg_op='DELETE' then 0 else (b->>k)::numeric end;
    if prev is not distinct from next and tg_op<>'INSERT' then continue; end if;
    d:=coalesce(next,0)-coalesce(prev,0);
    insert into public.stock_quantity_events(company_id,source_table,source_id,field,kind,before_qty,after_qty,delta,actor_id,evidence)
      values((b->>'company_id')::uuid,tg_table_name,(b->>'id')::uuid,k,
        case when tg_op='INSERT' then 'receipt' when tg_op='DELETE' then 'issue' when d>0 then 'adjustment_in' else 'adjustment_out' end,
        prev,next,d,auth.uid(),jsonb_build_object('operation',tg_op,'origin_type',b->>'origin_type','production_job_id',b->>'production_job_id',
          'reference',coalesce(b->>'batch_number',b->>'bundle_number',b->>'item_code',b->>'material_code'),'note',b->>'notes'));
  end loop;
  return null;
end $$;
revoke all on function private.ap5_journal_quantity() from public,anon,authenticated;
create function private.ap5_keep_events() returns trigger language plpgsql set search_path=public,private as $$
begin raise exception 'AP: This history is append-only.' using errcode='42501'; end $$;
revoke all on function private.ap5_keep_events() from public,anon,authenticated;
create trigger ap5_keep_stock_events before update or delete on public.stock_quantity_events for each row execute function private.ap5_keep_events();
do $$ declare t text; fields text[]; args text; k text; begin
  for t,fields in select * from (values
    ('inventory_items',array['current_stock']),('profile_stock_batches',array['total_weight_kg','quantity_pieces','length_m']),
    ('billet_batches',array['total_weight_kg','available_weight_kg']),('packaging_materials',array['current_stock']),
    ('foundry_aluminium_scrap',array['weight_kg','available_weight_kg']),('foundry_external_aluminium_sources',array['weight_kg','available_weight_kg'])) x(t,f) loop
    foreach k in array fields loop
      execute format('insert into public.stock_quantity_events(company_id,source_table,source_id,field,kind,before_qty,after_qty,delta,evidence)
        select company_id,%L,id,%L,''baseline'',null,%I,coalesce(%I,0),jsonb_build_object(''basis'',''Balance at AP-047 migration boundary'') from public.%I',t,k,k,k,t);
    end loop;
    select string_agg(quote_literal(v),',') into args from unnest(fields) v;
    execute format('create trigger zz_ap5_guard_quantity before update or delete on public.%I for each row execute function private.ap5_guard_quantity(%s)',t,args);
    execute format('create trigger zz_ap5_journal_quantity after insert or update or delete on public.%I for each row execute function private.ap5_journal_quantity(%s)',t,args);
  end loop;
end $$;

-- Keep the old atomic writer intact behind the threshold-aware entry point.
alter function private.post_inventory_adjustment(uuid,text,numeric,text) rename to ap5_inventory_adjustment_unchecked;
create function private.post_inventory_adjustment(p_item_id uuid,p_direction text,p_quantity numeric,p_reason text) returns uuid
language plpgsql security definer set search_path=public,private as $$
declare c record; threshold numeric;
begin
  select * into c from private.ap_ctx(array['owner','admin','inventory_manager','factory_manager']);
  select coalesce((select x.threshold from public.stock_adjustment_policies x where x.company_id=c.company_id),0) into threshold;
  if p_quantity>threshold then raise exception 'AP: This correction needs another person. Request it from the stock movements screen.'; end if;
  return private.ap5_inventory_adjustment_unchecked(p_item_id,p_direction,p_quantity,p_reason);
end $$;
revoke all on function private.post_inventory_adjustment(uuid,text,numeric,text) from public,anon,authenticated;

create function public.ap_stock(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c record; r public.stock_adjustment_requests%rowtype; it public.inventory_items%rowtype; v_rows jsonb; v_total bigint; v_id uuid;
  v_page integer:=private.ap3_page(p_payload); v_search text:=coalesce(p_payload->>'search',''); v_fp text; v_threshold numeric; v_reason text;
begin
  select * into c from private.ap_ctx(array['owner','admin','inventory_manager','factory_manager','production_manager','accounts']);
  if p_command='stock_policy' then
    perform private.ap_keys(p_payload,array[]::text[]);
    return jsonb_build_object('threshold',coalesce((select threshold from public.stock_adjustment_policies where company_id=c.company_id),0));
  elsif p_command='save_stock_policy' then
    perform private.ap4_need(c.role,array['owner','admin']); perform private.ap_keys(p_payload,array['threshold','reason']);
    insert into public.stock_adjustment_policies(company_id,threshold,reason,updated_by) values(c.company_id,private.ap4_num(p_payload,'threshold','Threshold',0,100000000),private.ap_text(p_payload->>'reason','Reason',10,500),c.actor_id)
      on conflict(company_id) do update set threshold=excluded.threshold,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp();
    return jsonb_build_object('saved',true);
  elsif p_command='request_adjustment' then
    perform private.ap4_need(c.role,array['owner','admin','inventory_manager','factory_manager']);
    perform private.ap_keys(p_payload,array['request_id','item_id','direction','quantity','expected_stock','reason']);
    perform 1 from public.companies where id=c.company_id for update;
    v_id:=private.ap_uuid(p_payload,'request_id'); v_fp:=md5((p_payload-'request_id')::text);
    perform pg_advisory_xact_lock(hashtextextended(c.company_id::text||v_id::text,0));
    select * into r from public.stock_adjustment_requests where id=v_id and company_id=c.company_id;
    if r.id is not null then
      if r.fingerprint<>v_fp or r.requested_by<>c.actor_id then raise exception 'AP: This retry has different details.'; end if;
      return jsonb_build_object('id',r.id,'status',r.status,'repeated',true);
    end if;
    select * into it from public.inventory_items where id=private.ap_uuid(p_payload,'item_id') and company_id=c.company_id for update;
    if it.id is null then raise exception 'AP: Inventory item not found.'; end if;
    if it.current_stock is distinct from private.ap4_num(p_payload,'expected_stock','Previous balance',0,100000000) then raise exception 'AP: The balance changed. Reload and review the correction.'; end if;
    if coalesce(p_payload->>'direction','') not in ('in','out') then raise exception 'AP: Choose in or out.'; end if;
    v_threshold:=coalesce((select threshold from public.stock_adjustment_policies where company_id=c.company_id),0);
    insert into public.stock_adjustment_requests(id,company_id,item_id,direction,quantity,expected_stock,reason,status,requested_by,fingerprint)
      values(v_id,c.company_id,it.id,p_payload->>'direction',private.ap4_num(p_payload,'quantity','Quantity',0.001,100000000),it.current_stock,
        private.ap_text(p_payload->>'reason','Reason',10,500),'requested',c.actor_id,v_fp) returning * into r;
    if r.quantity<=v_threshold then
      v_id:=private.post_inventory_adjustment(it.id,r.direction,r.quantity,r.reason);
      update public.stock_adjustment_requests set status='posted',movement_id=v_id,decided_by=c.actor_id,decided_at=clock_timestamp() where id=r.id;
      r.status:='posted';
    end if;
    return jsonb_build_object('id',r.id,'status',r.status);
  elsif p_command='decide_adjustment' then
    perform private.ap4_need(c.role,array['owner','admin','inventory_manager','factory_manager']);
    perform private.ap_keys(p_payload,array['id','decision','reason']);
    perform 1 from public.companies where id=c.company_id for update;
    select * into r from public.stock_adjustment_requests where id=private.ap_uuid(p_payload,'id') and company_id=c.company_id for update;
    if r.id is null then raise exception 'AP: Correction not found.'; end if;
    if r.status<>'requested' then return jsonb_build_object('status',r.status,'repeated',true); end if;
    if r.requested_by=c.actor_id then raise exception 'AP: Another person must decide your correction.'; end if;
    if coalesce(p_payload->>'decision','') not in ('approve','reject') then raise exception 'AP: Choose approve or reject.'; end if;
    v_reason:=private.ap_text(p_payload->>'reason','Reason',10,500);
    select * into it from public.inventory_items where id=r.item_id and company_id=c.company_id for update;
    if p_payload->>'decision'='reject' then r.status:='rejected';
    elsif it.current_stock is distinct from r.expected_stock then r.status:='stale';
    else v_id:=private.ap5_inventory_adjustment_unchecked(it.id,r.direction,r.quantity,r.reason||' / Approved: '||v_reason); r.status:='posted'; end if;
    update public.stock_adjustment_requests set status=r.status,movement_id=v_id,decided_by=c.actor_id,decided_at=clock_timestamp(),decision_reason=v_reason where id=r.id;
    return jsonb_build_object('status',r.status);
  elsif p_command='balances' then
    perform private.ap_keys(p_payload,array['page','search','sort','show']);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select to_jsonb(x)||jsonb_build_object('unit',inv.unit) row,row_number() over(order by case when p_payload->>'sort'='name' then x.item_name end,x.item_code,x.inventory_item_id) k,count(*) over() total
      from public.inventory_ledger_reconciliation x join public.inventory_items inv on inv.id=x.inventory_item_id
      where x.company_id=c.company_id and (x.item_name||' '||x.item_code) ilike '%'||v_search||'%'
        and (coalesce(p_payload->>'show','attention')='all' or abs(x.difference)>0.0005)
      order by k limit 10 offset (v_page-1)*10) z;
  elsif p_command='movements' then
    perform private.ap_keys(p_payload,array['page','search','sort','show','item_id']);
    select * into it from public.inventory_items where id=private.ap_uuid(p_payload,'item_id') and company_id=c.company_id;
    if it.id is null then raise exception 'AP: Inventory item not found.'; end if;
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select jsonb_build_object('id',m.id,'kind',m.movement_type,'quantity',m.quantity,'signed_quantity',m.quantity*private.inventory_movement_sign(m.movement_type),
        'date',m.movement_date,'reference',m.reference_type,'reason',m.notes,'actor',private.ap4_user_name(m.created_by)) row,
        row_number() over(order by case when p_payload->>'sort'='name' then m.movement_type end,m.movement_date desc,m.created_at desc,m.id) k,count(*) over() total
      from public.inventory_movements m where m.company_id=c.company_id and m.inventory_item_id=it.id and coalesce(m.notes,'')||' '||m.movement_type ilike '%'||v_search||'%'
      order by k limit 10 offset (v_page-1)*10) z;
    return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page,'item',jsonb_build_object('id',it.id,'name',it.item_name,'stock',it.current_stock,'unit',it.unit),
      'ledger_stock',(select coalesce(sum(m.quantity*private.inventory_movement_sign(m.movement_type)),0) from public.inventory_movements m where m.company_id=c.company_id and m.inventory_item_id=it.id));
  elsif p_command='requests' then
    perform private.ap_keys(p_payload,array['page','search','sort','show','item_id']);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select to_jsonb(a)||jsonb_build_object('item',inv.item_name,'can_decide',a.requested_by<>c.actor_id and c.role=any(array['owner','admin','inventory_manager','factory_manager'])) row,
        row_number() over(order by a.requested_at,a.id) k,count(*) over() total
      from public.stock_adjustment_requests a join public.inventory_items inv on inv.id=a.item_id
      where a.company_id=c.company_id and (p_payload->>'item_id' is null or a.item_id=(p_payload->>'item_id')::uuid)
        and (coalesce(p_payload->>'show','attention')='all' or a.status='requested') and inv.item_name ilike '%'||v_search||'%'
      order by k limit 10 offset (v_page-1)*10) z;
  elsif p_command='trace' then
    perform private.ap_keys(p_payload,array['page','search','sort','show','table','id']);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select to_jsonb(e) row,row_number() over(order by e.id desc) k,count(*) over() total from public.stock_quantity_events e
      where e.company_id=c.company_id and e.source_table=p_payload->>'table' and e.source_id=private.ap_uuid(p_payload,'id') and e.field ilike '%'||v_search||'%'
      order by k limit 10 offset (v_page-1)*10) z;
    return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page,
      'rebuilt',(select jsonb_object_agg(x.field,x.qty) from (select field,sum(delta) qty from public.stock_quantity_events e where e.company_id=c.company_id and e.source_table=p_payload->>'table' and e.source_id=private.ap_uuid(p_payload,'id') group by field) x));
  else raise exception 'AP: Unknown request.';
  end if;
  return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page);
end $$;
revoke all on function public.ap_stock(text,jsonb) from public,anon;
grant execute on function public.ap_stock(text,jsonb) to authenticated;

-- AP-062: seven-day demand from jobs, labelled drafts, dated supply and the existing procurement links.
create function private.ap5_billet_sources(p_company uuid,p_alloy text,p_diameter numeric) returns jsonb
language sql stable security definer set search_path=public,private as $$
  select jsonb_build_object(
    'free_batches',coalesce((select jsonb_agg(jsonb_build_object('batch',b.batch_number,'available_kg',b.available_weight_kg)) from public.billet_batches b
      where b.company_id=p_company and b.status='available' and upper(btrim(b.alloy))=p_alloy and abs(b.diameter_mm-p_diameter*25.4)<=1),'[]'),
    'free_cast_billets',coalesce((select jsonb_agg(jsonb_build_object('billet',b.billet_code,'weight_kg',coalesce(b.measured_weight_kg,b.weight_kg))) from public.foundry_billets b
      where b.company_id=p_company and b.status='cast' and b.order_id is null and b.production_job_id is null and upper(btrim(b.alloy))=p_alloy and abs(b.billet_diameter_mm-p_diameter*25.4)<=1),'[]'),
    'purchase_orders',coalesce((select jsonb_agg(jsonb_build_object('number',po.po_number,'status',po.status,'arrival_date',sc.current_date_promised,
      'remaining_kg',greatest(l.ordered_quantity-coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company and rl.purchase_order_line_id=l.id),0),0),
      'included',po.status='open' and sc.current_date_promised between private.ist_today() and private.ist_today()+6))
      from public.procurement_supply_links sl join public.purchase_order_lines l on l.id=sl.purchase_order_line_id and l.company_id=p_company
      join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=p_company left join public.supplier_commitments sc on sc.purchase_order_id=po.id and sc.company_id=p_company
      where sl.company_id=p_company and upper(btrim(sl.alloy))=p_alloy and sl.diameter_inch=p_diameter and l.unit='kg'),'[]'),
    'planned_casts',coalesce((select jsonb_agg(jsonb_build_object('batch',b.batch_number,'date',b.production_date,'input_kg',coalesce(b.total_billet_weight_density_kg,b.total_billet_weight_kg)))
      from public.foundry_batches b where b.company_id=p_company and b.status in ('planned','melting') and b.production_date between private.ist_today() and private.ist_today()+6
        and upper(btrim(b.alloy))=p_alloy and abs(b.billet_diameter_mm-p_diameter*25.4)<=1),'[]'))
$$;
revoke all on function private.ap5_billet_sources(uuid,text,numeric) from public,anon,authenticated;
create function private.ap5_billet_forecast(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_rows jsonb; v_unknown integer; v_supply_unknown integer;
begin
  with jobs as (
    select j.id,coalesce(s.need_day,j.planned_date,private.ist_today()) need_day,
      upper(coalesce(r.alloy,p.alloy)) alloy,coalesce(r.billet_diameter_inch,p.billet_diameter_required_inch) diameter,
      case when inp.kg is not null then greatest(inp.kg-coalesce(allocated.kg,0),0) end kg,
      r.billet_weight_kg billet_kg,false uncertain,j.job_number reference,
      coalesce(j.extrusion_efficiency_percent,r.extrusion_efficiency_percent) recovery_percent,coalesce(allocated.kg,0) covered_input_kg
    from public.production_jobs j join public.aluminium_profiles p on p.id=j.profile_id and p.company_id=j.company_id
    left join lateral(select min((x.planned_start_at at time zone 'Asia/Kolkata')::date) need_day from public.production_plan_slots x where x.company_id=p_company and x.production_job_id=j.id and x.status in ('scheduled','released')) s on true
    left join lateral(select x.* from public.order_billet_requirements x where x.company_id=p_company and x.order_id=j.order_id and x.profile_id=j.profile_id and x.status<>'cancelled' order by x.id limit 1) r on true
    cross join lateral(select case when j.input_billet_weight>0 then j.input_billet_weight
      when j.planned_quantity_kg>0 and coalesce(j.extrusion_efficiency_percent,r.extrusion_efficiency_percent)>0
      then round(j.planned_quantity_kg/(coalesce(j.extrusion_efficiency_percent,r.extrusion_efficiency_percent)/100),3) end kg) inp
    left join lateral(select sum(coalesce(b.measured_weight_kg,b.weight_kg)) kg from public.foundry_billets b where b.company_id=p_company
      and b.production_job_id=j.id and b.status in ('allocated','issued','consumed')) allocated on true
    where j.company_id=p_company and j.status not in ('completed','cancelled')
  ), drafts as (
    select d.id,coalesce(d.due_date,private.ist_today()) need_day,upper(coalesce(g.alloy,p.alloy)) alloy,
      coalesce(r.billet_diameter_inch,p.billet_diameter_required_inch) diameter,
      case when r.extrusion_efficiency_percent>0 then round(d.required_kg/(r.extrusion_efficiency_percent/100),3) end kg,
      r.billet_weight_kg billet_kg,true uncertain,'Draft '||o.order_number reference,r.extrusion_efficiency_percent recovery_percent,0::numeric covered_input_kg
    from public.production_job_draft_lines d join public.production_job_drafts g on g.id=d.draft_id and g.company_id=p_company
    join public.aluminium_profiles p on p.id=d.profile_id and p.company_id=p_company join public.orders o on o.id=d.order_id and o.company_id=p_company
    left join lateral(select x.* from public.order_billet_requirements x where x.company_id=p_company and x.order_id=d.order_id and x.profile_id=d.profile_id and x.status<>'cancelled' order by x.id limit 1) r on true
    where d.company_id=p_company and d.status='open' and g.status='open' and o.current_stage not in ('closed','cancelled','dispatched','delivered','payment_pending')
  ), demand as (select * from jobs union all select * from drafts),
  groups as (select alloy,diameter,min(billet_kg) filter(where billet_kg>0) billet_kg from demand where need_day<=private.ist_today()+6 group by alloy,diameter),
  daily as (
    select g.alloy,g.diameter,g.billet_kg,dd::date need_day,
      coalesce((select sum(d.kg) from demand d where d.alloy=g.alloy and d.diameter=g.diameter and greatest(d.need_day,private.ist_today())=dd::date and not d.uncertain),0) firm_kg,
      coalesce((select sum(d.kg) from demand d where d.alloy=g.alloy and d.diameter=g.diameter and greatest(d.need_day,private.ist_today())=dd::date and d.uncertain),0) draft_kg,
      (select case when bool_or(d.kg is null or (d.kg>0 and coalesce(d.billet_kg,0)<=0)) then null else coalesce(sum(case when d.kg=0 then 0 else ceil(d.kg/d.billet_kg) end),0) end
        from demand d where d.alloy=g.alloy and d.diameter=g.diameter and greatest(d.need_day,private.ist_today())=dd::date and not d.uncertain) firm_count,
      (select count(*) from demand d where d.alloy is not distinct from g.alloy and d.diameter is not distinct from g.diameter and greatest(d.need_day,private.ist_today())=dd::date and (d.kg is null or d.alloy is null or d.diameter is null)) missing,
      coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'reference',d.reference,'uncertain',d.uncertain,'input_kg',d.kg,'recovery_percent',d.recovery_percent,
        'linked_input_already_covered_kg',d.covered_input_kg,'billets',case when d.kg is not null and d.billet_kg>0 then ceil(d.kg/d.billet_kg) end))
        from demand d where d.alloy is not distinct from g.alloy and d.diameter is not distinct from g.diameter and greatest(d.need_day,private.ist_today())=dd::date),'[]') demand,
      coalesce((select sum(b.available_weight_kg) from public.billet_batches b where b.company_id=p_company and b.status='available' and upper(btrim(b.alloy))=g.alloy and abs(b.diameter_mm-g.diameter*25.4)<=1),0)
      +coalesce((select sum(coalesce(b.measured_weight_kg,b.weight_kg)) from public.foundry_billets b where b.company_id=p_company and b.status='cast' and b.order_id is null and b.production_job_id is null and upper(btrim(b.alloy))=g.alloy and abs(b.billet_diameter_mm-g.diameter*25.4)<=1),0) free_kg,
      coalesce((select sum(greatest(l.ordered_quantity-coalesce((select sum(rl.received_quantity) from public.purchase_receipt_lines rl where rl.company_id=p_company and rl.purchase_order_line_id=l.id),0),0))
        from public.procurement_supply_links sl join public.purchase_order_lines l on l.id=sl.purchase_order_line_id and l.company_id=p_company
        join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=p_company
        join public.supplier_commitments sc on sc.purchase_order_id=po.id and sc.company_id=p_company
        where sl.company_id=p_company and upper(btrim(sl.alloy))=g.alloy and sl.diameter_inch=g.diameter and po.status='open' and l.unit='kg'
          and sc.current_date_promised=dd::date and sc.current_date_promised>=private.ist_today()),0)
      +coalesce((select sum(coalesce(b.total_billet_weight_density_kg,b.total_billet_weight_kg)) from public.foundry_batches b where b.company_id=p_company
        and b.status in ('planned','melting') and b.production_date=dd::date and upper(btrim(b.alloy))=g.alloy and abs(b.billet_diameter_mm-g.diameter*25.4)<=1),0) incoming_kg
    from groups g cross join generate_series(private.ist_today()::timestamp,(private.ist_today()+6)::timestamp,interval '1 day') dd
  ), running as (
    select *,sum(firm_kg) over w firm_cumulative,sum(draft_kg) over w draft_cumulative,sum(incoming_kg) over w incoming_cumulative,
      sum(missing) over w unknown_cumulative from daily window w as(partition by alloy,diameter order by need_day)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.alloy nulls last,x.diameter nulls last),'[]') into v_rows from (
    select alloy,diameter, max(free_kg) free_kg,private.ap5_billet_sources(p_company,alloy,diameter) supply_sources,
      jsonb_agg(jsonb_build_object('date',need_day,'firm_kg',case when unknown_cumulative=0 then firm_kg end,'draft_kg',case when missing=0 then draft_kg end,
        'firm_count',case when unknown_cumulative=0 then firm_count end,'incoming_kg',incoming_kg,'unknown',missing,'demand',demand,
        'shortfall_kg',case when unknown_cumulative=0 and alloy is not null and diameter is not null then greatest(firm_cumulative-free_kg-incoming_cumulative,0) end,
        'with_drafts_shortfall_kg',case when unknown_cumulative=0 and alloy is not null and diameter is not null then greatest(firm_cumulative+draft_cumulative-free_kg-incoming_cumulative,0) end) order by need_day) days,
      case when max(unknown_cumulative)=0 and alloy is not null and diameter is not null then max(greatest(firm_cumulative-free_kg-incoming_cumulative,0)) end peak_shortfall_kg,
      min(need_day) filter(where firm_cumulative>free_kg+incoming_cumulative and unknown_cumulative=0) need_by
    from running group by alloy,diameter) x;
  select count(*) into v_supply_unknown from public.procurement_supply_links sl join public.purchase_order_lines l on l.id=sl.purchase_order_line_id and l.company_id=p_company
    join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=p_company left join public.supplier_commitments sc on sc.purchase_order_id=po.id and sc.company_id=p_company
    where sl.company_id=p_company and po.status='open' and (sc.id is null or sc.current_date_promised<private.ist_today());
  return jsonb_build_object('groups',v_rows,'as_of',clock_timestamp(),'today',private.ist_today(),'undated_or_overdue_supply',v_supply_unknown,
    'basis','Job billet input, else planned output / recorded recovery, minus billets already linked to that job. Drafts are uncertain and dated by their requirement. Supply counts only on its recorded date; free stock is used once. Counts use the recorded requirement billet weight.');
end $$;
revoke all on function private.ap5_billet_forecast(uuid) from public,anon,authenticated;

-- AP-063 uses the existing per-line fulfilment read model and factory working days.
create table public.order_line_predictions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), order_item_id uuid not null references public.order_items(id),
  order_id uuid not null references public.orders(id), predicted_on date not null, due_date date, estimated_date date, blocker text not null,
  is_red boolean not null, basis jsonb not null, created_at timestamptz not null default clock_timestamp(), unique(company_id,order_item_id,predicted_on)
);
create index order_line_predictions_company_idx on public.order_line_predictions(company_id,predicted_on,is_red,due_date,order_item_id);
create function private.ap5_predict_lines(p_company uuid) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare l record; h record; v_stats jsonb; v_start date; v_end date; v_finish integer; v_pack integer; v_prod integer;
  v_days integer; v_stage text; v_basis jsonb; v_n integer:=0; v_red integer:=0; v_sample integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':ap5-predict',0));
  -- Median elapsed stage durations are converted to working-day planning allowances and labelled with sample counts.
  with steps as (select stage,changed_at,lead(changed_at) over(partition by order_id order by changed_at,id) next_at
    from public.order_stage_history where company_id=p_company and changed_at>clock_timestamp()-interval '180 days'),
  stats as (select stage,ceil(percentile_cont(0.5) within group(order by private.factory_working_days_between(p_company,
    (changed_at at time zone 'Asia/Kolkata')::date,(next_at at time zone 'Asia/Kolkata')::date)))::integer days,count(*) n
    from steps where next_at>changed_at group by stage)
  select coalesce(jsonb_object_agg(stage,jsonb_build_object('days',days,'samples',n)),'{}') into v_stats from stats;
  for l in select r.*,oi.finishing_type from private.order_line_requirements(p_company,null) r join public.order_items oi on oi.id=r.order_item_id
    where not r.order_closed and (r.ordered_kg is null or r.dispatched_kg<r.ordered_kg-0.001) loop
    v_start:=private.ist_today(); v_days:=0; v_stage:='ready to dispatch'; v_finish:=0;
    v_pack:=case when coalesce((v_stats->'packing'->>'samples')::integer,0)>=3 then greatest(1,(v_stats->'packing'->>'days')::integer) else 1 end;
    v_prod:=case when coalesce((v_stats->'extrusion_planned'->>'samples')::integer,0)>=3 then greatest(1,(v_stats->'extrusion_planned'->>'days')::integer) else 2 end;
    if l.ordered_kg is null then v_stage:='quantity missing'; v_end:=null;
    else
      if l.produced_kg+l.from_stock_kg<l.ordered_kg-0.001 then
        v_stage:='production not planned';
        select max((s.planned_end_at at time zone 'Asia/Kolkata')::date),count(*) into v_end,v_sample
          from public.production_jobs j join public.production_plan_slots s on s.production_job_id=j.id and s.company_id=p_company and s.status in ('scheduled','released')
          where j.company_id=p_company and j.source_line_id=l.order_item_id and j.status not in ('completed','cancelled');
        if v_end is not null then v_start:=greatest(v_start,v_end); v_stage:='planned production';
          if l.produced_kg+l.from_stock_kg+l.planned_open_kg<l.ordered_kg-0.001 then v_days:=v_days+v_prod; v_stage:='production partially planned'; end if;
        else v_days:=v_prod; end if;
      end if;
      if coalesce(l.finishing_type,'mill_finish')<>'mill_finish' and l.packed_kg<l.ordered_kg-0.001 then
        select lead_days into v_finish from public.factory_finishing_lead_times where company_id=p_company and finishing_type=l.finishing_type;
        select max(coalesce(f.received_date,private.factory_add_working_days(p_company,f.sent_date,coalesce(v_finish,0)))) into v_end from public.finishing_jobs f
          join public.production_jobs j on j.id=f.production_job_id and j.company_id=p_company where f.company_id=p_company and j.source_line_id=l.order_item_id and f.status not in ('cancelled','received');
        if v_end is not null then v_start:=greatest(v_start,v_end); v_stage:='finishing at vendor';
        elsif v_finish is null then v_stage:='finishing lead time missing';
        else v_days:=v_days+v_finish; if v_stage='ready to dispatch' then v_stage:='finishing'; end if; end if;
      end if;
      if l.packed_kg<l.ordered_kg-0.001 then v_days:=v_days+v_pack; if v_stage='ready to dispatch' then v_stage:='packing'; end if; end if;
      v_end:=case when v_stage like '%missing%' then null else private.factory_add_working_days(p_company,v_start,v_days) end;
    end if;
    v_basis:=jsonb_build_object('rule','stage-plan-v1','progress',to_jsonb(l),'statistics',v_stats,'start',v_start,'remaining_working_days',v_days,
      'production_allowance_days',v_prod,'packing_allowance_days',v_pack,'finishing_lead_days',v_finish,
      'fallback','With fewer than three observations: production 2 working days, packing 1 working day. Advisory; calendar holidays applied.');
    insert into public.order_line_predictions(company_id,order_item_id,order_id,predicted_on,due_date,estimated_date,blocker,is_red,basis)
      values(p_company,l.order_item_id,l.order_id,private.ist_today(),l.effective_date,v_end,v_stage,
        l.effective_date is not null and (v_end is null or v_end>l.effective_date),v_basis)
      on conflict(company_id,order_item_id,predicted_on) do nothing;
    v_n:=v_n+1; if l.effective_date is not null and (v_end is null or v_end>l.effective_date) then v_red:=v_red+1; end if;
  end loop;
  return jsonb_build_object('examined',v_n,'proposals',0,'alerts',0,'details',jsonb_build_object('red',v_red));
end $$;
revoke all on function private.ap5_predict_lines(uuid) from public,anon,authenticated;

create function public.ap_planning(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c record; v_all jsonb; v_rows jsonb; v_total bigint; v_page integer:=private.ap3_page(p_payload); v_search text:=coalesce(p_payload->>'search','');
  g jsonb; v_id uuid; v_n integer:=0;
begin
  select * into c from private.ap_ctx(array['owner','admin','factory_manager','production_manager','inventory_manager','sales_manager','sales','dispatch_manager']);
  if p_command='predict' then
    perform private.ap_keys(p_payload,array[]::text[]); perform private.ap4_need(c.role,array['owner','admin','factory_manager','production_manager']);
    return private.ap5_predict_lines(c.company_id);
  elsif p_command='billet_forecast' then
    perform private.ap4_need(c.role,array['owner','admin','factory_manager','production_manager','inventory_manager']);
    perform private.ap_keys(p_payload,array['page','search','sort','show']); v_all:=private.ap5_billet_forecast(c.company_id);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select e row,row_number() over(order by case when p_payload->>'sort'='date' then e->>'need_by' end,e->>'alloy',(e->>'diameter')::numeric) k,count(*) over() total
      from jsonb_array_elements(v_all->'groups') e where coalesce(e->>'alloy','Unknown alloy') ilike '%'||v_search||'%'
        and (coalesce(p_payload->>'show','attention')='all' or e->>'peak_shortfall_kg' is null or (e->>'peak_shortfall_kg')::numeric>0)
      order by k limit 10 offset (v_page-1)*10) z;
    return (v_all-'groups')||jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page);
  elsif p_command='prepare_billet' then
    perform private.ap4_need(c.role,array['owner','admin','factory_manager','production_manager','inventory_manager']); perform private.ap_keys(p_payload,array[]::text[]);
    v_all:=private.ap5_billet_job(c.company_id,null);
    return jsonb_build_object('created',v_all->'proposals');
  elsif p_command='red_list' then
    perform private.ap_keys(p_payload,array['page','search','sort','show','order_id']);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select to_jsonb(pr)||jsonb_build_object('order_number',o.order_number,'customer',private.ap3_customer_name(o.customer_id),'profile',l.profile_code) row,
        row_number() over(order by case when p_payload->>'sort'='name' then o.order_number end,pr.due_date nulls last,pr.order_item_id) k,count(*) over() total
      from public.order_line_predictions pr join public.orders o on o.id=pr.order_id and o.company_id=c.company_id
      join lateral private.order_line_requirements(c.company_id,o.id) l on l.order_item_id=pr.order_item_id
      where pr.company_id=c.company_id and pr.predicted_on=private.ist_today() and not l.order_closed
        and (l.ordered_kg is null or l.dispatched_kg<l.ordered_kg-0.001) and (coalesce(p_payload->>'show','attention')='all' or pr.is_red)
        and (p_payload->>'order_id' is null or pr.order_id=(p_payload->>'order_id')::uuid)
        and (o.order_number||' '||coalesce(l.customer_name,'')) ilike '%'||v_search||'%'
      order by k limit 10 offset (v_page-1)*10) z;
    return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page,'today',private.ist_today(),
      'generated_at',(select max(created_at) from public.order_line_predictions where company_id=c.company_id and predicted_on=private.ist_today()),
      'early_warning',(with late as (select l.order_item_id,l.effective_date,max(d.dispatch_date) departed from private.order_line_requirements(c.company_id,null) l
        join public.packing_list_items p on p.order_item_id=l.order_item_id and p.company_id=c.company_id
        join public.dispatches d on d.id=p.dispatch_id and d.company_id=c.company_id and d.actual_dispatched_at is not null
        where l.dispatched_kg>=l.ordered_kg and l.effective_date>=private.ist_today()-90 group by l.order_item_id,l.effective_date having max(d.dispatch_date)>l.effective_date)
        select jsonb_build_object('late_lines',count(*),'warned_two_days_early',count(*) filter(where exists(select 1 from public.order_line_predictions x where x.company_id=c.company_id and x.order_item_id=late.order_item_id and x.is_red and x.predicted_on<=late.effective_date-2))) from late));
  end if;
  raise exception 'AP: Unknown request.';
end $$;
revoke all on function public.ap_planning(text,jsonb) from public,anon;
grant execute on function public.ap_planning(text,jsonb) to authenticated;

-- AP-078: terms remain versioned evidence. Medium enterprises are shown as outside this payment aid.
create table public.vendor_msme_terms (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), vendor_id uuid not null references public.vendors(id),
  category text not null check(category in ('micro','small','medium','none')), udyam text, agreed_days integer check(agreed_days between 1 and 365),
  reason text not null, recorded_by uuid not null references public.app_users(id), recorded_at timestamptz not null default clock_timestamp(),
  check(category='none' or (udyam is not null and udyam ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'))
);
create index vendor_msme_terms_company_idx on public.vendor_msme_terms(company_id,vendor_id,recorded_at desc,id);
create table public.msme_payment_policies (
  company_id uuid primary key references public.companies(id), statutory_limit integer not null check(statutory_limit between 1 and 45),
  no_agreement_days integer not null check(no_agreement_days between 1 and 15), reason text not null,
  updated_by uuid not null references public.app_users(id), updated_at timestamptz not null default clock_timestamp()
);
create table public.msme_bill_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), bill_id uuid not null references public.supplier_purchase_bills(id),
  accepted_on date, reason text not null, recorded_by uuid not null references public.app_users(id), recorded_at timestamptz not null default clock_timestamp()
);
create index msme_bill_events_company_idx on public.msme_bill_events(company_id,bill_id,recorded_at desc,id);
create trigger ap5_keep_msme_terms before update or delete on public.vendor_msme_terms for each row execute function private.ap5_keep_events();
create trigger ap5_keep_msme_bill_events before update or delete on public.msme_bill_events for each row execute function private.ap5_keep_events();

create function private.ap5_msme_bills(p_company uuid) returns table(bill_id uuid,vendor_id uuid,vendor text,invoice_number text,invoice_date date,
  balance numeric,accepted_on date,acceptance_basis text,deadline date,agreed_days integer,applied_days integer,udyam text,note text)
language sql stable security definer set search_path=public,private as $$
  select b.id,b.vendor_id,v.vendor_name,b.invoice_number,b.invoice_date,e.balance_amount,
    a.accepted_on,a.basis,a.accepted_on+case when t.agreed_days is null then coalesce(pol.no_agreement_days,15) else least(t.agreed_days,coalesce(pol.statutory_limit,45)) end,
    t.agreed_days,case when t.agreed_days is null then coalesce(pol.no_agreement_days,15) else least(t.agreed_days,coalesce(pol.statutory_limit,45)) end,t.udyam,
    (select ev.reason from public.msme_bill_events ev where ev.company_id=p_company and ev.bill_id=b.id order by ev.recorded_at desc,ev.id desc limit 1)
  from public.supplier_purchase_bills b join public.vendors v on v.id=b.vendor_id and v.company_id=p_company
  join lateral(select x.* from public.vendor_msme_terms x where x.company_id=p_company and x.vendor_id=v.id order by x.recorded_at desc,x.id desc limit 1) t on t.category in ('micro','small')
  join public.expense_ledger e on e.id=b.expense_ledger_id and e.company_id=p_company and e.deleted_at is null and e.balance_amount>0
  left join public.msme_payment_policies pol on pol.company_id=p_company
  cross join lateral(select (select x.accepted_on from public.msme_bill_events x where x.company_id=p_company and x.bill_id=b.id and x.accepted_on is not null order by x.recorded_at desc,x.id desc limit 1) accepted_on,
    'Accounts confirmed acceptance (receipt date and invoice date are not assumed)'::text basis) a
  where b.company_id=p_company and b.status='posted'
$$;
revoke all on function private.ap5_msme_bills(uuid) from public,anon,authenticated;

-- AP-085: fingerprints include item identities, balances and versions, not only counts.
create table public.month_close_exceptions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), period_month date not null,
  fingerprint text not null, checklist jsonb not null, reason text not null, requested_by uuid not null references public.app_users(id),
  requested_at timestamptz not null default clock_timestamp(), status text not null default 'requested' check(status in ('requested','approved','rejected','used','superseded')),
  decided_by uuid references public.app_users(id), decided_at timestamptz, decision_reason text, used_at timestamptz
);
create index month_close_exceptions_company_idx on public.month_close_exceptions(company_id,period_month,status,requested_at desc);
create table public.month_close_heads (
  company_id uuid primary key references public.companies(id), actor_id uuid not null references public.app_users(id),
  set_by uuid not null references public.app_users(id), set_at timestamptz not null default clock_timestamp()
);
create function private.ap5_close_checklist(p_company uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_end date:=(date_trunc('month',p_month)+interval '1 month - 1 day')::date; v_items jsonb; v_total integer;
begin
  with blockers as (
    select 'unbilled' kind,'Unbilled dispatches' label,'/invoices/drafts?tab=unbilled' href,d.id::text id,
      jsonb_build_array(d.id,d.updated_at,d.total_weight_kg) version
    from public.dispatches d where d.company_id=p_company and d.actual_dispatched_at is not null
      and d.dispatch_date<=v_end and d.delivery_status not in ('cancelled','pending')
      and not exists(select 1 from public.invoices i where i.company_id=p_company and i.dispatch_id=d.id and i.status<>'cancelled')
    union all
    select 'drafts','Draft invoices','/invoices/drafts',d.id::text,jsonb_build_array(d.id,d.refreshed_at,d.status,d.source_fingerprint)
      from public.invoice_drafts d where d.company_id=p_company and d.invoice_date<=v_end and d.status in ('open','blocked')
    union all
    select 'on_account','Unallocated receipts','/payments/receipts#allocate',a.id::text,jsonb_build_array(a.id,a.amount,a.applied_amount,a.status)
      from public.customer_on_account_credits a where a.company_id=p_company and a.received_on<=v_end and a.status='open' and a.amount>a.applied_amount
    union all
    select 'grn','GRNs without fully posted bills','/vendors/purchasing',rl.id::text,jsonb_build_array(rl.id,rl.accepted_quantity,
      coalesce((select sum(bl.quantity) from public.supplier_purchase_bill_lines bl join public.supplier_purchase_bills b on b.id=bl.supplier_bill_id and b.company_id=p_company and b.status='posted'
        where bl.company_id=p_company and bl.purchase_order_line_id=rl.purchase_order_line_id),0))
      from public.purchase_receipt_lines rl join public.purchase_receipts r on r.id=rl.receipt_id and r.company_id=p_company
      where rl.company_id=p_company and r.receipt_date<=v_end and rl.accepted_quantity>0
        and (select sum(x.accepted_quantity) from public.purchase_receipt_lines x join public.purchase_receipts xr on xr.id=x.receipt_id and xr.company_id=p_company
          where x.company_id=p_company and x.purchase_order_line_id=rl.purchase_order_line_id and xr.receipt_date<=v_end)
          >coalesce((select sum(bl.quantity) from public.supplier_purchase_bill_lines bl join public.supplier_purchase_bills b on b.id=bl.supplier_bill_id and b.company_id=p_company and b.status='posted' and b.invoice_date<=v_end
            where bl.company_id=p_company and bl.purchase_order_line_id=rl.purchase_order_line_id),0)
    union all
    select 'bank','Unreconciled bank credits','/payments/bank',l.id::text,jsonb_build_array(l.id,l.state,l.amount,l.customer_id)
      from public.bank_statement_lines l where l.company_id=p_company and l.txn_date<=v_end and l.direction='credit' and l.state not in ('receipted','ignored')
    union all
    select 'stock','Open stock corrections','/inventory/movements',a.id::text,jsonb_build_array(a.id,a.status,a.quantity,a.expected_stock)
      from public.stock_adjustment_requests a where a.company_id=p_company and (a.requested_at at time zone 'Asia/Kolkata')::date<=v_end and a.status='requested'
    union all
    select 'stock_variance','Unresolved cycle-count variances','/inventory/work/assurance/cycle_counts',l.id::text,jsonb_build_array(l.id,l.status,l.expected_kg,l.expected_pieces)
      from public.cycle_count_lines l join public.cycle_counts ct on ct.id=l.count_id and ct.company_id=p_company where l.company_id=p_company
        and (ct.cutoff_at at time zone 'Asia/Kolkata')::date<=v_end and l.status in ('difference','moved','unlisted','recount')
    union all
    select 'ledger','Stock ledger differences','/inventory/movements',x.inventory_item_id::text,to_jsonb(x)
      from public.inventory_ledger_reconciliation x where x.company_id=p_company and abs(x.difference)>0.0005
    union all
    select 'tally','Unexported Tally vouchers','/invoices/tally',x.kind||':'||x.id,jsonb_build_array(x.kind,x.id,x.amount)
      from private.ap4_tally_vouchers(p_company,p_month,v_end) x
      where not exists(select 1 from public.tally_export_vouchers t where t.company_id=p_company and t.voucher_kind=x.kind and t.voucher_id=x.id and t.status='exported')
  ), grouped as (
    select kind,label,href,count(*) n,jsonb_agg(version order by id) versions from blockers group by kind,label,href
  ) select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'label',label,'href',href,'count',n,'versions',versions) order by kind),'[]'),coalesce(sum(n),0)::integer
    into v_items,v_total from grouped;
  return jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'blocking_count',v_total,'items',v_items,'fingerprint',md5(v_items::text),
    'basis','Open items through month end; stock ledger differences use current reconciled balances. Each exception covers these exact source versions.');
end $$;
revoke all on function private.ap5_close_checklist(uuid,date) from public,anon,authenticated;

alter function private.ap_close_month(uuid,uuid,text,date,text) rename to ap5_close_month_original;
create function private.ap_close_month(p_company uuid,p_actor uuid,p_role text,p_month date,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_check jsonb; v_exception uuid; v_head uuid; v_result jsonb;
begin
  perform 1 from public.companies where id=p_company for update;
  if (date_trunc('month',p_month)+interval '1 month - 1 day')::date>=private.ist_today()
    or (date_trunc('month',p_month)+interval '1 month - 1 day')::date<=private.books_locked_through(p_company) then
    return private.ap5_close_month_original(p_company,p_actor,p_role,p_month,p_reason);
  end if;
  select actor_id into v_head from public.month_close_heads where company_id=p_company;
  if (v_head is not null and p_actor<>v_head) or (v_head is null and p_role not in ('owner','admin')) then raise exception 'AP: Only the nominated accounts head can close the month.' using errcode='42501'; end if;
  v_check:=private.ap5_close_checklist(p_company,date_trunc('month',p_month)::date);
  if (v_check->>'blocking_count')::integer>0 then
    select e.id into v_exception from public.month_close_exceptions e where e.company_id=p_company and e.period_month=date_trunc('month',p_month)::date
      and e.fingerprint=v_check->>'fingerprint' and e.status='approved' and e.decided_by<>p_actor order by e.decided_at desc limit 1 for update;
    if v_exception is null then raise exception 'AP: Clear the month-close blockers or obtain another approver''s exception for these exact items.'; end if;
  end if;
  v_result:=private.ap5_close_month_original(p_company,p_actor,p_role,p_month,p_reason);
  if v_exception is not null then update public.month_close_exceptions set status='used',used_at=clock_timestamp() where id=v_exception; end if;
  return v_result;
end $$;
revoke all on function private.ap_close_month(uuid,uuid,text,date,text) from public,anon,authenticated;

-- The legacy lock control is also a close entry point; it cannot skip AP-085.
alter function private.set_books_locked_through(date,text) rename to ap5_previous_set_books_locked_through;
create function private.set_books_locked_through(p_locked_through date,p_reason text) returns uuid
language plpgsql security definer set search_path=public,private as $$
declare c record; v_check jsonb; v_head uuid; v_ex uuid; v_id uuid;
begin
  select * into c from private.ap_ctx(array['owner','admin','accounts']);
  perform 1 from public.companies where id=c.company_id for update;
  if private.books_locked_through(c.company_id) is null or p_locked_through>private.books_locked_through(c.company_id) then
    select actor_id into v_head from public.month_close_heads where company_id=c.company_id;
    if (v_head is not null and v_head<>c.actor_id) or (v_head is null and c.role not in ('owner','admin')) then raise exception 'AP: Only the nominated accounts head can close the month.' using errcode='42501'; end if;
    v_check:=private.ap5_close_checklist(c.company_id,date_trunc('month',p_locked_through)::date);
    if (v_check->>'blocking_count')::integer>0 then
      select e.id into v_ex from public.month_close_exceptions e where e.company_id=c.company_id and e.period_month=date_trunc('month',p_locked_through)::date
        and e.status='approved' and e.fingerprint=v_check->>'fingerprint' and e.decided_by<>c.actor_id order by e.decided_at desc limit 1 for update;
      if v_ex is null then raise exception 'AP: Clear the month-close blockers or obtain another approver''s exception for these exact items.'; end if;
    end if;
  end if;
  v_id:=private.ap5_previous_set_books_locked_through(p_locked_through,p_reason);
  if v_ex is not null then update public.month_close_exceptions set status='used',used_at=clock_timestamp() where id=v_ex; end if;
  return v_id;
end $$;
revoke all on function private.set_books_locked_through(date,text) from public,anon,authenticated;

create function public.ap_accounts(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c record; v_rows jsonb; v_total bigint; v_page integer:=private.ap3_page(p_payload); v_search text:=coalesce(p_payload->>'search',''); v_month date; v_check jsonb;
  ex public.month_close_exceptions%rowtype; v_id uuid; v_vendor uuid; v_bill uuid; v_reason text; v_date date; v_head uuid;
begin
  select * into c from private.ap_ctx(array['owner','admin','accounts']);
  if p_command='close_checklist' then
    perform private.ap_keys(p_payload,array['month']); v_month:=((p_payload->>'month')||'-01')::date;
    v_check:=private.ap5_close_checklist(c.company_id,v_month);
    select actor_id into v_head from public.month_close_heads where company_id=c.company_id;
    return v_check||jsonb_build_object('can_close',case when v_head is null then c.role in ('owner','admin') else c.actor_id=v_head end,
      'head',coalesce(private.ap4_user_name(v_head),'Owner/admin until an accounts head is nominated'),
      'exceptions',coalesce((select jsonb_agg(to_jsonb(z)) from (select e.*,private.ap4_user_name(e.requested_by) requester,
        e.requested_by<>c.actor_id and c.role in ('owner','admin') can_decide from public.month_close_exceptions e where e.company_id=c.company_id and e.period_month=v_month order by e.requested_at desc limit 10) z),'[]'));
  elsif p_command='head_options' then
    perform private.ap4_need(c.role,array['owner','admin']); perform private.ap_keys(p_payload,array[]::text[]);
    return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name,'role',u.role) order by u.full_name,u.id)
      from public.app_users u where u.company_id=c.company_id and u.is_active and u.role in ('owner','admin','accounts')),'[]');
  elsif p_command='nominate_close_head' then
    perform private.ap4_need(c.role,array['owner','admin']); perform private.ap_keys(p_payload,array['actor_id']); v_id:=private.ap_uuid(p_payload,'actor_id');
    if not exists(select 1 from public.app_users u where u.id=v_id and u.company_id=c.company_id and u.is_active and u.role in ('owner','admin','accounts')) then raise exception 'AP: Choose an active accounts head.'; end if;
    insert into public.month_close_heads(company_id,actor_id,set_by) values(c.company_id,v_id,c.actor_id) on conflict(company_id) do update set actor_id=excluded.actor_id,set_by=excluded.set_by,set_at=clock_timestamp();
    return jsonb_build_object('saved',true);
  elsif p_command='request_close_exception' then
    perform private.ap_keys(p_payload,array['month','fingerprint','reason']); v_month:=((p_payload->>'month')||'-01')::date;
    perform 1 from public.companies where id=c.company_id for update;
    v_check:=private.ap5_close_checklist(c.company_id,v_month);
    if v_check->>'fingerprint' is distinct from p_payload->>'fingerprint' then raise exception 'AP: Open items changed; reload the checklist.'; end if;
    if (v_check->>'blocking_count')::integer=0 then raise exception 'AP: No blockers need an exception.'; end if;
    update public.month_close_exceptions set status='superseded' where company_id=c.company_id and period_month=v_month and status in ('requested','approved');
    insert into public.month_close_exceptions(company_id,period_month,fingerprint,checklist,reason,requested_by)
      values(c.company_id,v_month,v_check->>'fingerprint',v_check,private.ap_text(p_payload->>'reason','Reason',10,500),c.actor_id) returning id into v_id;
    return jsonb_build_object('id',v_id);
  elsif p_command='decide_close_exception' then
    perform private.ap4_need(c.role,array['owner','admin']); perform private.ap_keys(p_payload,array['id','decision','reason']);
    select * into ex from public.month_close_exceptions where id=private.ap_uuid(p_payload,'id') and company_id=c.company_id for update;
    if ex.id is null or ex.status<>'requested' then raise exception 'AP: This exception is no longer waiting.'; end if;
    if ex.requested_by=c.actor_id then raise exception 'AP: Another person must decide your exception.'; end if;
    if coalesce(p_payload->>'decision','') not in ('approve','reject') then raise exception 'AP: Choose approve or reject.'; end if;
    v_check:=private.ap5_close_checklist(c.company_id,ex.period_month);
    if p_payload->>'decision'='approve' and ex.fingerprint<>v_check->>'fingerprint' then raise exception 'AP: Open items changed; request a fresh exception.'; end if;
    update public.month_close_exceptions set status=case when p_payload->>'decision'='approve' then 'approved' else 'rejected' end,decided_by=c.actor_id,
      decided_at=clock_timestamp(),decision_reason=private.ap_text(p_payload->>'reason','Reason',10,500) where id=ex.id;
    return jsonb_build_object('saved',true);
  elsif p_command='save_msme_vendor' then
    perform private.ap_keys(p_payload,array['vendor_id','category','udyam','agreed_days','reason']); v_vendor:=private.ap_uuid(p_payload,'vendor_id');
    if not exists(select 1 from public.vendors v where v.id=v_vendor and v.company_id=c.company_id) then raise exception 'AP: Vendor not found.'; end if;
    if coalesce(p_payload->>'category','') not in ('micro','small','medium','none') then raise exception 'AP: Choose the supplier category.'; end if;
    if p_payload->>'category'<>'none' and coalesce(p_payload->>'udyam','') !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then raise exception 'AP: Enter the Udyam number.'; end if;
    perform 1 from public.vendors where id=v_vendor for update;
    insert into public.vendor_msme_terms(company_id,vendor_id,category,udyam,agreed_days,reason,recorded_by)
      values(c.company_id,v_vendor,p_payload->>'category',p_payload->>'udyam',private.ap4_num(p_payload,'agreed_days','Agreed days',1,365,false)::integer,
        private.ap_text(p_payload->>'reason','Reason',10,500),c.actor_id);
    return jsonb_build_object('saved',true);
  elsif p_command='save_msme_policy' then
    perform private.ap_keys(p_payload,array['statutory_limit','no_agreement_days','reason']);
    insert into public.msme_payment_policies(company_id,statutory_limit,no_agreement_days,reason,updated_by) values(c.company_id,
      private.ap4_num(p_payload,'statutory_limit','Written agreement cap',1,45)::integer,private.ap4_num(p_payload,'no_agreement_days','No agreement period',1,15)::integer,
      private.ap_text(p_payload->>'reason','Reason',10,500),c.actor_id)
      on conflict(company_id) do update set statutory_limit=excluded.statutory_limit,no_agreement_days=excluded.no_agreement_days,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=clock_timestamp();
    return jsonb_build_object('saved',true);
  elsif p_command='msme_vendor' then
    perform private.ap_keys(p_payload,array['vendor_id']); v_vendor:=private.ap_uuid(p_payload,'vendor_id');
    if not exists(select 1 from public.vendors where id=v_vendor and company_id=c.company_id) then raise exception 'AP: Vendor not found.'; end if;
    return jsonb_build_object('terms',(select to_jsonb(t) from public.vendor_msme_terms t where company_id=c.company_id and vendor_id=v_vendor order by recorded_at desc,id desc limit 1),
      'history',coalesce((select jsonb_agg(to_jsonb(z)) from (select * from public.vendor_msme_terms where company_id=c.company_id and vendor_id=v_vendor order by recorded_at desc,id desc limit 10) z),'[]'));
  elsif p_command in ('bill_acceptance','msme_note') then
    perform private.ap_keys(p_payload,case when p_command='bill_acceptance' then array['bill_id','accepted_on','reason'] else array['bill_id','reason'] end);
    v_bill:=private.ap_uuid(p_payload,'bill_id');
    if not exists(select 1 from public.supplier_purchase_bills b where b.id=v_bill and b.company_id=c.company_id) then raise exception 'AP: Bill not found.'; end if;
    if p_command='bill_acceptance' then v_date:=(p_payload->>'accepted_on')::date;
      if v_date is null or v_date>private.ist_today() then raise exception 'AP: Acceptance must be a recorded date on or before today.'; end if;
    end if;
    insert into public.msme_bill_events(company_id,bill_id,accepted_on,reason,recorded_by) values(c.company_id,v_bill,v_date,private.ap_text(p_payload->>'reason','Reason',10,500),c.actor_id);
    return jsonb_build_object('saved',true);
  elsif p_command='msme_queue' then
    perform private.ap_keys(p_payload,array['page','search','sort','show']);
    select coalesce(jsonb_agg(z.row order by z.k),'[]'),max(z.total) into v_rows,v_total from (
      select to_jsonb(b)||jsonb_build_object('overdue',b.deadline<private.ist_today()) row,
        row_number() over(order by case when p_payload->>'sort'='name' then b.vendor end,b.deadline nulls first,b.bill_id) k,count(*) over() total
      from private.ap5_msme_bills(c.company_id) b where b.vendor||' '||b.invoice_number ilike '%'||v_search||'%'
        and (coalesce(p_payload->>'show','attention')='all' or b.deadline is null or b.deadline<=private.ist_today()+7) order by k limit 10 offset(v_page-1)*10) z;
    return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0),'page',v_page,'today',private.ist_today(),
      'policy',jsonb_build_object('statutory_limit',coalesce((select statutory_limit from public.msme_payment_policies where company_id=c.company_id),45),
        'no_agreement_days',coalesce((select no_agreement_days from public.msme_payment_policies where company_id=c.company_id),15)),
      'basis','Payment tracking aid, not legal advice. Accounts confirms the acceptance date, supplier classification and written terms. Missing acceptance dates remain unknown.');
  end if;
  raise exception 'AP: Unknown request.';
end $$;
revoke all on function public.ap_accounts(text,jsonb) from public,anon;
grant execute on function public.ap_accounts(text,jsonb) to authenticated;

-- Preserve financial-review access while distinguishing who may close the month in the old AP-059 screen.
alter function public.ap_period(text,jsonb) set schema private;
alter function private.ap_period(text,jsonb) rename to ap5_previous_period;
revoke all on function private.ap5_previous_period(text,jsonb) from public,anon,authenticated;
create function public.ap_period(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c record; v_result jsonb; v_head uuid;
begin
  v_result:=private.ap5_previous_period(p_command,p_payload);
  if p_command='overview' then
    select * into c from private.ap_ctx(null);
    select actor_id into v_head from public.month_close_heads where company_id=c.company_id;
    v_result:=v_result||jsonb_build_object('can_close_month',case when v_head is null then c.role in ('owner','admin') else c.actor_id=v_head end);
  end if;
  return v_result;
end $$;
revoke all on function public.ap_period(text,jsonb) from public,anon;
grant execute on function public.ap_period(text,jsonb) to authenticated;

-- AP-080: one immutable snapshot per factory day. Read/copy events never imply sending.
create table public.owner_daily_digests (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), digest_date date not null,
  generated_at timestamptz not null default clock_timestamp(), metrics jsonb not null, message text not null, unique(company_id,digest_date)
);
create index owner_daily_digests_company_idx on public.owner_daily_digests(company_id,digest_date desc);
create table public.owner_digest_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), digest_id uuid not null references public.owner_daily_digests(id),
  kind text not null check(kind in ('read','copied')), actor_id uuid not null references public.app_users(id), recorded_at timestamptz not null default clock_timestamp(),
  unique(company_id,digest_id,kind,actor_id)
);
create index owner_digest_events_company_idx on public.owner_digest_events(company_id,recorded_at desc);
create trigger ap5_keep_digest before update or delete on public.owner_daily_digests for each row execute function private.ap5_keep_events();
create function private.ap5_digest(p_company uuid) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_day date:=private.ist_today(); v_yesterday date:=private.ist_today()-1; m jsonb; v_text text; d public.owner_daily_digests%rowtype;
  v_input numeric; v_good numeric; v_recovery numeric; v_missing integer; v_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':owner-digest:'||v_day::text,0));
  select * into d from public.owner_daily_digests where company_id=p_company and digest_date=v_day;
  if d.id is not null then return to_jsonb(d); end if;
  select sum(actual_quantity_kg),sum(input_billet_weight),count(*) filter(where coalesce(input_billet_weight,0)<=0),count(*)
    into v_good,v_input,v_missing,v_total from public.production_jobs where company_id=p_company and status='completed' and (completed_at at time zone 'Asia/Kolkata')::date=v_yesterday;
  v_recovery:=case when v_missing=0 and v_input>0 then round(v_good/v_input*100,2) end;
  m:=jsonb_build_object('production_kg',case when v_total=0 then 0 else v_good end,'recovery_percent',v_recovery,'recovery_missing_jobs',v_missing,
    'dispatch_kg',(select coalesce(sum(total_weight_kg),0) from public.dispatches where company_id=p_company and delivery_status not in ('pending','cancelled') and (actual_dispatched_at at time zone 'Asia/Kolkata')::date=v_yesterday),
    'invoiced',(select coalesce(sum(grand_total),0) from public.invoices where company_id=p_company and invoice_date=v_yesterday and deleted_at is null and opening_cutover_id is null and status in ('generated','sent','partially_paid','paid','overdue','credited')),
    'collections',(select coalesce(sum(p.amount),0) from public.payments p where p.company_id=p_company and p.payment_date=v_yesterday and p.payment_status='PAID'
        and not exists(select 1 from public.customer_on_account_applications a where a.company_id=p_company and a.receipt_event_id=p.receipt_event_id))
      +(select coalesce(sum(amount),0) from public.customer_on_account_credits where company_id=p_company and received_on=v_yesterday and status<>'reversed'),
    'overdue',(select coalesce(sum(balance_due),0) from public.invoices where company_id=p_company and deleted_at is null and due_date<v_day and status not in ('cancelled','draft') and balance_due>0),
    'credit_holds',(select count(*) from public.order_credit_holds where company_id=p_company and status='held'),
    'red_lines',(select count(*) from public.order_line_predictions pr where pr.company_id=p_company and pr.predicted_on=(select max(predicted_on) from public.order_line_predictions where company_id=p_company) and pr.is_red
      and exists(select 1 from private.order_line_requirements(p_company,pr.order_id) r where r.order_item_id=pr.order_item_id and not r.order_closed and (r.ordered_kg is null or r.dispatched_kg<r.ordered_kg-0.001))),
    'red_list_as_of',(select max(created_at) from public.order_line_predictions where company_id=p_company),
    'idle_presses',(select count(*) from (select distinct machine_id from public.production_jobs where company_id=p_company and status='in_progress' and machine_id is not null) presses
      cross join lateral private.ap2_settings(p_company,presses.machine_id) settings
      cross join lateral(select max(p.event_at) last_push from private.ap2_pushes p where p.company_id=p_company and p.machine_id=presses.machine_id) last_event
      where clock_timestamp()-last_event.last_push>make_interval(mins=>settings.idle_gap_minutes)),
    'owner_approvals',(select count(*) from public.quote_floor_exceptions where company_id=p_company and status='requested')
      +(select count(*) from public.month_close_exceptions where company_id=p_company and status='requested')
      +(select count(*) from public.stock_adjustment_requests where company_id=p_company and status='requested'));
  v_text:='Omalco morning digest - '||v_day||E'\nFigures as of '||to_char(clock_timestamp() at time zone 'Asia/Kolkata','DD Mon YYYY HH24:MI')||E' IST\nYesterday ('||v_yesterday||'): production '||coalesce(m->>'production_kg','unknown')||' kg; recovery '||coalesce((m->>'recovery_percent')||'%','unknown (input evidence missing)')||E'\nDispatch '||(m->>'dispatch_kg')||' kg; invoicing INR '||(m->>'invoiced')||'; collections INR '||(m->>'collections')||E'\nOverdue INR '||(m->>'overdue')||'; credit holds '||(m->>'credit_holds')||'; red-list lines '||(m->>'red_lines')||E'\nIdle presses (configured thresholds, recorded pushes): '||(m->>'idle_presses')||'; pending owner approvals: '||(m->>'owner_approvals')||E'\nInternal management summary. Predictions are advisory; check their generation time.';
  insert into public.owner_daily_digests(company_id,digest_date,metrics,message) values(p_company,v_day,m,v_text) returning * into d;
  return to_jsonb(d);
end $$;
revoke all on function private.ap5_digest(uuid) from public,anon,authenticated;
create function public.ap_digest(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c record; d public.owner_daily_digests%rowtype;
begin
  select * into c from private.ap_ctx(array['owner','admin','factory_manager']);
  if p_command='digest' then
    perform private.ap_keys(p_payload,array['date']);
    select * into d from public.owner_daily_digests where company_id=c.company_id and digest_date=coalesce((p_payload->>'date')::date,private.ist_today());
    return case when d.id is null then null else to_jsonb(d) end;
  elsif p_command='prepare_digest' then perform private.ap_keys(p_payload,array[]::text[]); return private.ap5_digest(c.company_id);
  elsif p_command='digest_read' then
    perform private.ap_keys(p_payload,array['id','kind']);
    select * into d from public.owner_daily_digests where id=private.ap_uuid(p_payload,'id') and company_id=c.company_id;
    if d.id is null then raise exception 'AP: Digest not found.'; end if;
    if coalesce(p_payload->>'kind','') not in ('read','copied') then raise exception 'AP: Choose read or copied.'; end if;
    insert into public.owner_digest_events(company_id,digest_id,kind,actor_id) values(c.company_id,d.id,p_payload->>'kind',c.actor_id) on conflict do nothing;
    return jsonb_build_object('recorded',true,'state','copied_is_not_sent');
  end if;
  raise exception 'AP: Unknown request.';
end $$;
revoke all on function public.ap_digest(text,jsonb) from public,anon;
grant execute on function public.ap_digest(text,jsonb) to authenticated;

-- Billet proposals use the shared AP-002 lifecycle, including changed-source rejection and decision statistics.
alter table public.proposals drop constraint proposals_proposal_type_check;
alter table public.proposals add constraint proposals_proposal_type_check check(proposal_type in
  ('navigation.role_layout','period.close_month','series.adopt','production.expected_output','die.service_due','maintenance.pm_due','bank.receipt_match','freight.estimate','billet.shortage'));
alter function private.ap_proposal_versions(uuid,text,text) rename to ap5_previous_proposal_versions;
create function private.ap_proposal_versions(p_company uuid,p_type text,p_target text) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare g jsonb;
begin
  if p_type='billet.shortage' then
    select e into g from jsonb_array_elements(private.ap5_billet_forecast(p_company)->'groups') e where (e->>'alloy')||':'||(e->>'diameter')=p_target;
    return jsonb_build_object('forecast',g,'today',private.ist_today());
  end if;
  return private.ap5_previous_proposal_versions(p_company,p_type,p_target);
end $$;
revoke all on function private.ap_proposal_versions(uuid,text,text) from public,anon,authenticated;
alter function private.ap_proposal_editable(text) rename to ap5_previous_proposal_editable;
create function private.ap_proposal_editable(p_type text) returns text[] language sql immutable set search_path=public,private as $$
  select case when p_type='billet.shortage' then array['route'] else private.ap5_previous_proposal_editable(p_type) end
$$;
revoke all on function private.ap_proposal_editable(text) from public,anon,authenticated;
alter function private.ap_proposal_apply(uuid,uuid,text,public.proposals,jsonb) rename to ap5_previous_proposal_apply;
create function private.ap_proposal_apply(p_company uuid,p_actor uuid,p_role text,p_proposal public.proposals,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare v_task uuid; v_assignee uuid;
begin
  if p_proposal.proposal_type='billet.shortage' then
    if p_role not in ('owner','admin','factory_manager','production_manager','inventory_manager') then raise exception 'Not permitted' using errcode='42501'; end if;
    perform private.ap_keys(p_payload,array['alloy','diameter','quantity_kg','need_by','route']);
    if coalesce(p_payload->>'route','') not in ('purchase','foundry') then raise exception 'AP: Choose purchase or foundry.'; end if;
    select u.id into v_assignee from public.app_users u where u.company_id=p_company and u.is_active and u.role=case when p_payload->>'route'='purchase' then 'inventory_manager' else 'production_manager' end order by u.id limit 1;
    insert into public.tasks(company_id,title,description,task_type,assigned_to,created_by,priority,status,due_date,related_entity_type,related_entity_id)
      values(p_company,'Prepare '||(p_payload->>'route')||' for '||(p_payload->>'alloy')||' billet shortage',
        'Confirmed requirement: '||(p_payload->>'quantity_kg')||' kg / '||(p_payload->>'diameter')||' inch, needed '||(p_payload->>'need_by')||'. Recheck the seven-day forecast before creating the purchase order or cast. No stock or purchase order has been posted.',
        'manual',coalesce(v_assignee,p_actor),p_actor,'high','open',(p_payload->>'need_by')::date,null,null) returning id into v_task;
    return jsonb_build_object('task_id',v_task,'route',p_payload->>'route','message','Requirement confirmed; create the purchase order or cast through its normal workflow.');
  end if;
  return private.ap5_previous_proposal_apply(p_company,p_actor,p_role,p_proposal,p_payload);
end $$;
revoke all on function private.ap_proposal_apply(uuid,uuid,text,public.proposals,jsonb) from public,anon,authenticated;

create function private.ap5_billet_job(p_company uuid,p_run uuid) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare g jsonb; v_id uuid; v_n integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':billet-proposals',0));
  for g in select e from jsonb_array_elements(private.ap5_billet_forecast(p_company)->'groups') e where (e->>'peak_shortfall_kg')::numeric>0 loop
    if exists(select 1 from public.proposals p where p.company_id=p_company and p.proposal_type='billet.shortage' and p.target_key=(g->>'alloy')||':'||(g->>'diameter')
      and p.status in ('accepted','edited')
      and exists(select 1 from public.tasks t where t.company_id=p_company and t.id=(p.outcome->>'task_id')::uuid and t.status not in ('completed','cancelled'))) then continue; end if;
    v_id:=private.ap_proposal_create(p_company,'billet.shortage',(g->>'alloy')||':'||(g->>'diameter'),
      'Billet shortage: '||(g->>'alloy')||' / '||(g->>'diameter')||' inch',
      jsonb_build_object('alloy',g->>'alloy','diameter',g->'diameter','quantity_kg',g->'peak_shortfall_kg','need_by',g->'need_by','route','purchase'),g,
      'seven-day-input-v1','Firm jobs exceed free stock and dated supply. Draft demand is shown separately.',null,
      array['owner','admin','factory_manager','production_manager','inventory_manager'],24,p_run);
    if v_id is not null then v_n:=v_n+1; end if;
  end loop;
  return jsonb_build_object('examined',v_n,'proposals',v_n,'alerts',0);
end $$;
revoke all on function private.ap5_billet_job(uuid,uuid) from public,anon,authenticated;

alter function private.ap_job_registry() rename to ap5_previous_job_registry;
create function private.ap_job_registry() returns table(job_key text,schedule text,label text,description text)
language sql immutable set search_path=public,private as $$
  select * from private.ap5_previous_job_registry() union all values
    ('billets.forecast','nightly','Prepare seven-day billet requirements','Proposes confirmed billet shortages against dated supply; drafts stay uncertain.'),
    ('orders.predict_late','nightly','Predict late order lines','Keeps a daily advisory prediction and blocking stage for every open line.'),
    ('owner.digest','morning','Prepare the owner digest','Stores an internal morning snapshot, marked with its generation time. Nothing is sent.')
$$;
revoke all on function private.ap_job_registry() from public,anon,authenticated;
alter function private.ap_job_execute(uuid,text,uuid) rename to ap5_previous_job_execute;
create function private.ap_job_execute(p_company uuid,p_job text,p_run uuid) returns jsonb
language plpgsql security definer set search_path=public,private as $$
begin
  if p_job='billets.forecast' then return private.ap5_billet_job(p_company,p_run);
  elsif p_job='orders.predict_late' then return private.ap5_predict_lines(p_company);
  elsif p_job='owner.digest' then perform private.ap5_digest(p_company); return jsonb_build_object('examined',1,'proposals',0,'alerts',0); end if;
  return private.ap5_previous_job_execute(p_company,p_job,p_run);
end $$;
revoke all on function private.ap_job_execute(uuid,text,uuid) from public,anon,authenticated;

do $$ declare t text; roles text; begin
  foreach t in array array['stock_adjustment_policies','stock_adjustment_requests','stock_quantity_events','order_line_predictions','vendor_msme_terms',
    'msme_payment_policies','msme_bill_events','month_close_exceptions','month_close_heads','owner_daily_digests','owner_digest_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    roles:=case when t in ('owner_daily_digests','owner_digest_events') then 'array[''owner'',''admin'',''factory_manager'']'
      when t in ('vendor_msme_terms','msme_payment_policies','msme_bill_events','month_close_exceptions','month_close_heads') then 'array[''owner'',''admin'',''accounts'']'
      else 'array[''owner'',''admin'',''accounts'',''factory_manager'',''inventory_manager'',''production_manager'',''sales_manager'',''sales'',''dispatch_manager'']' end;
    execute format('create policy ap5_read on public.%I for select to authenticated using(company_id=(select public.get_current_user_company_id()) and (select public.get_current_user_role())=any(%s))',t,roles);
  end loop;
end $$;

commit;

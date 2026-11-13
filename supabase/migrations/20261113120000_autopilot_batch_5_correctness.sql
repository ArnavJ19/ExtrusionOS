-- Autopilot batch 5 correctness: AP-062, AP-063 and AP-085.
-- Applies after the completion migration; earlier migration history remains unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

-- Missing uncertain demand must not erase a known firm requirement.
create or replace function private.ap5_billet_forecast(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_rows jsonb; v_supply_unknown integer;
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
      (select count(*) from demand d where d.alloy is not distinct from g.alloy and d.diameter is not distinct from g.diameter
        and greatest(d.need_day,private.ist_today())=dd::date and not d.uncertain and (d.kg is null or d.alloy is null or d.diameter is null)) firm_missing,
      (select count(*) from demand d where d.alloy is not distinct from g.alloy and d.diameter is not distinct from g.diameter
        and greatest(d.need_day,private.ist_today())=dd::date and d.uncertain and (d.kg is null or d.alloy is null or d.diameter is null)) draft_missing,
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
      sum(firm_missing) over w firm_unknown_cumulative,sum(draft_missing) over w draft_unknown_cumulative
      from daily window w as(partition by alloy,diameter order by need_day)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.alloy nulls last,x.diameter nulls last),'[]') into v_rows from (
    select alloy,diameter, max(free_kg) free_kg,private.ap5_billet_sources(p_company,alloy,diameter) supply_sources,
      jsonb_agg(jsonb_build_object('date',need_day,
        'firm_kg',case when firm_missing=0 and alloy is not null and diameter is not null then firm_kg end,
        'draft_kg',case when draft_missing=0 and alloy is not null and diameter is not null then draft_kg end,
        'firm_count',case when firm_missing=0 and alloy is not null and diameter is not null then firm_count end,
        'incoming_kg',incoming_kg,'unknown',firm_missing+draft_missing,'firm_unknown',firm_missing,'draft_unknown',draft_missing,'demand',demand,
        'shortfall_kg',case when firm_unknown_cumulative=0 and alloy is not null and diameter is not null then greatest(firm_cumulative-free_kg-incoming_cumulative,0) end,
        'with_drafts_shortfall_kg',case when firm_unknown_cumulative=0 and draft_unknown_cumulative=0 and alloy is not null and diameter is not null
          then greatest(firm_cumulative+draft_cumulative-free_kg-incoming_cumulative,0) end) order by need_day) days,
      case when max(firm_unknown_cumulative)=0 and alloy is not null and diameter is not null then max(greatest(firm_cumulative-free_kg-incoming_cumulative,0)) end peak_shortfall_kg,
      min(need_day) filter(where firm_cumulative>free_kg+incoming_cumulative and firm_unknown_cumulative=0) need_by
    from running group by alloy,diameter) x;
  select count(*) into v_supply_unknown from public.procurement_supply_links sl join public.purchase_order_lines l on l.id=sl.purchase_order_line_id and l.company_id=p_company
    join public.purchase_orders po on po.id=l.purchase_order_id and po.company_id=p_company left join public.supplier_commitments sc on sc.purchase_order_id=po.id and sc.company_id=p_company
    where sl.company_id=p_company and po.status='open' and (sc.id is null or sc.current_date_promised<private.ist_today());
  return jsonb_build_object('groups',v_rows,'as_of',clock_timestamp(),'today',private.ist_today(),'undated_or_overdue_supply',v_supply_unknown,
    'basis','Job billet input, else planned output / recorded recovery, minus billets already linked to that job. Drafts are uncertain and dated by their requirement; missing draft inputs do not hide firm requirements. Supply counts only on its recorded date; free stock is used once. Counts use the recorded requirement billet weight.');
end $$;
revoke all on function private.ap5_billet_forecast(uuid) from public,anon,authenticated;

-- A vendor sent date is not a completion date when the finishing lead is unknown.
create or replace function private.ap5_predict_lines(p_company uuid) returns jsonb
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
        if v_finish is null then
          v_stage:='finishing lead time missing';
        else
          select max(coalesce(f.received_date,private.factory_add_working_days(p_company,f.sent_date,v_finish))) into v_end from public.finishing_jobs f
            join public.production_jobs j on j.id=f.production_job_id and j.company_id=p_company where f.company_id=p_company and j.source_line_id=l.order_item_id and f.status not in ('cancelled','received');
          if v_end is not null then v_start:=greatest(v_start,v_end); v_stage:='finishing at vendor';
          else v_days:=v_days+v_finish; if v_stage='ready to dispatch' then v_stage:='finishing'; end if; end if;
        end if;
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

-- Every observation and review is part of the exact-source close approval.
create or replace function private.ap5_close_checklist(p_company uuid,p_month date) returns jsonb
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
    select 'stock_variance','Unresolved cycle-count variances','/inventory/work/assurance/cycle_counts',l.id::text,
      jsonb_build_array(l.id,l.status,l.expected_kg,l.expected_pieces,l.profile_stock_batch_id,l.batch_snapshot,l.reviewed_at,l.reviewed_by,l.review_note,
        coalesce((select jsonb_agg(jsonb_build_array(obs.id,obs.round,obs.counted_pieces,obs.counted_kg,obs.counted_by,obs.counted_at,obs.note) order by obs.round,obs.id)
          from public.cycle_count_observations obs where obs.company_id=p_company and obs.line_id=l.id),'[]'::jsonb))
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

commit;

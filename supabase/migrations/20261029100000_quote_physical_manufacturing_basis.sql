-- New quote conversions plan physical material independently of commercial billing minima.
begin;

alter table public.orders add column quote_physical_planning_version integer not null default 0
  check (quote_physical_planning_version in (0,1));
comment on column public.orders.quote_physical_planning_version is
  '0 preserves historical planning; 1 derives new quote-backed physical demand without a billing minimum.';

create function private.require_quote_physical_weight(p_weight numeric) returns numeric
language plpgsql immutable set search_path=public,private as $$
begin
  if p_weight is null or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight<=0 then
    raise exception 'A recorded positive physical profile weight is required for manufacturing';
  end if;
  return round(p_weight,3);
end;
$$;
revoke all on function private.require_quote_physical_weight(numeric) from public,anon,authenticated;

create function private.quote_requirement_weight(p_order_id uuid,p_quote_item_id uuid,p_physical numeric,p_billing numeric)
returns numeric language plpgsql stable set search_path=public,private as $$
declare v_order public.orders%rowtype;v_count integer;v_weight numeric;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'Order planning source is unavailable'; end if;
  if v_order.quote_physical_planning_version=0 then return coalesce(p_billing,p_physical,0); end if;
  select count(*),sum(coalesce(manufacturing_weight_kg,quantity_kg)) into v_count,v_weight
    from public.order_items where company_id=v_order.company_id and order_id=p_order_id and quote_item_id=p_quote_item_id;
  -- The initial order-insert trigger runs before its lines exist. Later rebuilds use exact remaining line demand.
  if v_count=0 then return private.require_quote_physical_weight(p_physical); end if;
  if v_count<>1 or v_weight is null or v_weight::text in ('NaN','Infinity','-Infinity') or v_weight<0 then
    raise exception 'The exact order line manufacturing requirement is unavailable';
  end if;
  return round(v_weight,3);
end;
$$;
revoke all on function private.quote_requirement_weight(uuid,uuid,numeric,numeric) from public,anon,authenticated;

create function private.quote_billet_summary_update_valid(p_new public.orders,p_old public.orders)
returns boolean language plpgsql stable set search_path=public,private as $$
declare v_required integer;v_allocated integer;v_short integer;v_status text;
begin
  if (to_jsonb(p_new)-array['billets_required','billets_allocated','billets_short','billet_allocation_status','current_stage','updated_at'])
    is distinct from (to_jsonb(p_old)-array['billets_required','billets_allocated','billets_short','billet_allocation_status','current_stage','updated_at']) then return false; end if;
  select coalesce(sum(billets_required),0),coalesce(sum(billets_allocated),0),coalesce(sum(billets_short),0)
    into v_required,v_allocated,v_short from public.order_billet_requirements
    where company_id=p_new.company_id and order_id=p_new.id and status<>'cancelled';
  v_status:=case when v_required<=0 then 'not_required' when v_allocated<=0 then 'shortage'
    when v_allocated<v_required or v_short>0 then 'partial' else 'complete' end;
  return p_new.billets_required is not distinct from v_required and p_new.billets_allocated is not distinct from v_allocated
    and p_new.billets_short is not distinct from v_short and p_new.billet_allocation_status is not distinct from v_status
    and (p_new.current_stage is not distinct from p_old.current_stage
      or (v_status='complete' and p_old.current_stage in ('order_confirmed','die_ready') and p_new.current_stage='billet_ready'));
end;
$$;
revoke all on function private.quote_billet_summary_update_valid(public.orders,public.orders) from public,anon,authenticated;

-- Patch only reviewed expressions, preserving the current locks, source guards, ACLs and financial snapshots.
-- Prerequisite drift is an error rather than an unreviewed replacement of a function body.
do $$
declare change record;definition text;matches integer;
begin
  for change in select * from (values
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'coalesce(billing_weight_kg, total_weight_kg, 0)', 'private.require_quote_physical_weight(total_weight_kg)',1),
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'coalesce(item.billing_weight_kg, item.total_weight_kg, 0)', 'private.require_quote_physical_weight(item.total_weight_kg)',2),
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'coalesce(quote_item.billing_weight_kg, quote_item.total_weight_kg, order_item.quantity_kg, 0)', 'private.require_quote_physical_weight(quote_item.total_weight_kg)',1),
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'created_by_organization_type, created_by_dealership_id, order_origin', 'created_by_organization_type, created_by_dealership_id, order_origin, quote_physical_planning_version',1),
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'v_user_id, v_user_id, v_user_role, v_user_org_type, v_dealer_id, v_order_origin', 'v_user_id, v_user_id, v_user_role, v_user_org_type, v_dealer_id, v_order_origin, 1',1),
    ('private.create_order_from_quote_with_dealer_stock(uuid,text,date,date,text,numeric,text)',
      'Quote has no billable profile weight', 'Quote has no recorded physical profile weight',1),
    ('public.get_dealer_quote_stock_availability(uuid)',
      'coalesce(line.billing_weight_kg,line.total_weight_kg,0)', 'private.require_quote_physical_weight(line.total_weight_kg)',1),
    ('private.guard_order_item_workflow_writes()',
      'coalesce(source.billing_weight_kg,source.total_weight_kg,0)', 'coalesce(new.quantity_kg,source.total_weight_kg,0)',1),
    ('private.guard_order_workflow_writes()',
      $before$if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])$before$,
      $after$if private.quote_billet_summary_update_valid(new,old) then return new; end if;
    if (to_jsonb(new)-array['dealer_fulfilled_weight_kg','manufacturing_weight_kg','fulfillment_notes','updated_at'])$after$,1),
    ('public.rebuild_order_billet_requirements(uuid)',
      'coalesce(qi.billing_weight_kg, qi.total_weight_kg, 0)', 'private.quote_requirement_weight(v_order.id,qi.id,qi.total_weight_kg,qi.billing_weight_kg)',2),
    ('public.rebuild_order_billet_requirements(uuid)',
      'coalesce(nullif(v_order.manufacturing_weight_kg, 0), nullif(v_order.production_quantity_kg, 0), v_quote_total, 0)',
      'case when v_order.quote_physical_planning_version=1 then coalesce(v_order.manufacturing_weight_kg,0) else coalesce(nullif(v_order.manufacturing_weight_kg, 0), nullif(v_order.production_quantity_kg, 0), v_quote_total, 0) end',1)
  ) as changes(signature,before_text,after_text,expected_matches)
  loop
    select pg_get_functiondef(change.signature::regprocedure) into definition;
    matches:=(length(definition)-length(replace(definition,change.before_text,'')))/length(change.before_text);
    if matches<>change.expected_matches then raise exception 'Physical planning prerequisite drift for %: expected %, found %',change.signature,change.expected_matches,matches; end if;
    execute replace(definition,change.before_text,change.after_text);
  end loop;
end;
$$;
commit;

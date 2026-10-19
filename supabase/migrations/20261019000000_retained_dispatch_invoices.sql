-- Prepared only. Bill retained posted shipments without reopening a cancelled order.
begin;

create or replace function private.invoice_dispatch_is_billable(p_company_id uuid,p_order_id uuid,p_dispatch_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,private as $$
declare
  v_order public.orders%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_cancelled_at timestamptz;
begin
  select * into v_order from public.orders where id=p_order_id and company_id=p_company_id;
  if not found or v_order.deleted_at is not null then return false; end if;
  select * into v_dispatch from public.dispatches where id=p_dispatch_id and company_id=p_company_id and order_id=p_order_id;
  if not found or v_dispatch.delivery_status is null or v_dispatch.delivery_status not in ('pending','dispatched','in_transit','delivered') then return false; end if;
  if v_order.current_stage is distinct from 'cancelled' then return true; end if;

  select max(changed_at) into v_cancelled_at from public.order_stage_history
  where company_id=p_company_id and order_id=p_order_id and stage='cancelled';
  if v_cancelled_at is null or v_cancelled_at::text in ('infinity','-infinity') or v_cancelled_at>now()
    or v_dispatch.delivery_status not in ('dispatched','in_transit','delivered')
    or v_dispatch.actual_dispatched_at is null or v_dispatch.actual_dispatched_at::text in ('infinity','-infinity')
    or v_dispatch.created_at is null or v_dispatch.created_at::text in ('infinity','-infinity')
    or v_dispatch.created_at>v_dispatch.actual_dispatched_at or v_dispatch.actual_dispatched_at>v_cancelled_at
    or v_dispatch.total_weight_kg is null or v_dispatch.total_weight_kg<=0
    or v_dispatch.total_weight_kg::text in ('NaN','Infinity','-Infinity') then return false; end if;

  return (
    with packing as materialized (
      select * from public.packing_list_items where company_id=p_company_id and dispatch_id=p_dispatch_id
    ), source_groups as (
      select source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id,
        sum(net_weight_kg) weight_kg,sum(net_length_m) length_m,sum(number_of_pieces) pieces
      from packing group by source_kind,source_record_id,source_line_id,reservation_id,profile_stock_batch_id,profile_id
    ), posted_source_totals as (
      select item.source_kind,item.source_record_id,item.source_line_id,item.profile_id,
        sum(item.net_weight_kg) weight_kg,sum(item.net_length_m) length_m,sum(item.number_of_pieces) pieces,
        bool_and(item.net_weight_kg is not null and item.net_weight_kg>0 and item.net_weight_kg::text not in ('NaN','Infinity','-Infinity')
          and item.net_length_m is not null and item.net_length_m>0 and item.net_length_m::text not in ('NaN','Infinity','-Infinity')
          and item.number_of_pieces is not null and item.number_of_pieces>0) valid_units
      from public.packing_list_items item join public.dispatches dispatch_record
        on dispatch_record.id=item.dispatch_id and dispatch_record.company_id=item.company_id
      where dispatch_record.company_id=p_company_id and dispatch_record.order_id=p_order_id
        and dispatch_record.actual_dispatched_at is not null
      group by item.source_kind,item.source_record_id,item.source_line_id,item.profile_id
    )
    select exists(select 1 from packing)
      and abs((select sum(net_weight_kg) from packing)-v_dispatch.total_weight_kg)<=0.001 and not exists(
      select 1 from packing where profile_id is null or source_kind is null
        or net_weight_kg is null or net_weight_kg<=0 or net_weight_kg::text in ('NaN','Infinity','-Infinity')
        or net_length_m is null or net_length_m<=0 or net_length_m::text in ('NaN','Infinity','-Infinity')
        or number_of_pieces is null or number_of_pieces<=0
        or net_rate is null or net_rate<=0 or net_rate::text in ('NaN','Infinity','-Infinity')
        or operator_verified_by is null or operator_verified_at is null
        or operator_verified_at::text in ('infinity','-infinity') or operator_verified_at>v_dispatch.actual_dispatched_at
        or not exists(select 1 from public.app_users verifier where verifier.id=packing.operator_verified_by and verifier.company_id=p_company_id)
    ) and not exists (
      select 1 from public.profile_stock_consumptions consumed where consumed.dispatch_id=p_dispatch_id
        and not exists(select 1 from source_groups source where source.source_kind='reservation'
          and consumed.company_id=p_company_id and consumed.order_id=p_order_id
          and consumed.reservation_id=source.reservation_id and consumed.profile_id=source.profile_id
          and consumed.profile_stock_batch_id=source.profile_stock_batch_id
          and abs(consumed.consumed_weight_kg-source.weight_kg)<=0.001
          and abs(consumed.consumed_length_m-source.length_m)<=0.001 and consumed.consumed_pieces=source.pieces)
    ) and not exists (
      select 1 from source_groups source where not coalesce(case source.source_kind
        when 'reservation' then exists(
          select 1 from public.profile_stock_reservations reservation
          join public.profile_stock_batches batch on batch.id=reservation.profile_stock_batch_id and batch.company_id=reservation.company_id and batch.profile_id=reservation.profile_id
          join public.profile_stock_consumptions consumed on consumed.reservation_id=reservation.id and consumed.company_id=reservation.company_id
            and consumed.dispatch_id=p_dispatch_id and consumed.order_id=p_order_id
            and consumed.profile_id=reservation.profile_id and consumed.profile_stock_batch_id=reservation.profile_stock_batch_id
          where reservation.company_id=p_company_id and reservation.order_id=p_order_id and reservation.id=source.reservation_id
            and source.source_record_id=p_order_id and source.source_line_id=reservation.id
            and source.profile_id=reservation.profile_id and source.profile_stock_batch_id=reservation.profile_stock_batch_id
            and consumed.created_at is not null and consumed.created_at::text not in ('infinity','-infinity') and consumed.created_at<=v_cancelled_at
            and abs(consumed.consumed_weight_kg-source.weight_kg)<=0.001
            and abs(consumed.consumed_length_m-source.length_m)<=0.001 and consumed.consumed_pieces=source.pieces
        )
        when 'dealer_stock' then exists(
          select 1 from public.order_dealer_stock_fulfillments fulfillment
          join public.profile_stock_batches batch on batch.id=fulfillment.profile_stock_batch_id and batch.company_id=fulfillment.company_id and batch.profile_id=fulfillment.profile_id
          join posted_source_totals posted on posted.source_kind=source.source_kind and posted.source_line_id=source.source_line_id
            and posted.source_record_id=source.source_record_id and posted.profile_id=source.profile_id
          where fulfillment.id=source.source_line_id and fulfillment.company_id=p_company_id and fulfillment.order_id=p_order_id
            and source.source_record_id=p_order_id and fulfillment.profile_id=source.profile_id and fulfillment.credited_at is null
            and (source.profile_stock_batch_id is null or source.profile_stock_batch_id=fulfillment.profile_stock_batch_id)
            and fulfillment.created_at is not null and fulfillment.created_at::text not in ('infinity','-infinity') and fulfillment.created_at<=v_dispatch.actual_dispatched_at
            and fulfillment.fulfilled_weight_kg::text not in ('NaN','Infinity','-Infinity') and fulfillment.fulfilled_length_m::text not in ('NaN','Infinity','-Infinity')
            and posted.valid_units and posted.weight_kg<=fulfillment.fulfilled_weight_kg+0.001 and posted.length_m<=fulfillment.fulfilled_length_m+0.001
            and posted.pieces<=fulfillment.fulfilled_pieces
        )
        when 'production' then exists(
          select 1 from public.production_jobs job
          join posted_source_totals posted on posted.source_kind=source.source_kind and posted.source_line_id=source.source_line_id
            and posted.source_record_id=source.source_record_id and posted.profile_id=source.profile_id
          where job.id=source.source_line_id and source.source_record_id=p_order_id and job.company_id=p_company_id and job.order_id=p_order_id
            and job.profile_id=source.profile_id and job.status='completed'
            and job.completed_at is not null and job.completed_at::text not in ('infinity','-infinity') and job.completed_at<=v_dispatch.actual_dispatched_at
            and job.actual_quantity_kg::text not in ('NaN','Infinity','-Infinity') and job.actual_meters::text not in ('NaN','Infinity','-Infinity')
            and posted.valid_units and posted.weight_kg<=job.actual_quantity_kg+0.001 and posted.length_m<=job.actual_meters+0.001
            and posted.pieces<=job.actual_pieces
        ) else false end,false)
    )
  );
end;
$$;
revoke all on function private.invoice_dispatch_is_billable(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.validate_invoice_dispatch_billable()
returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if new.dispatch_id is null or new.status='cancelled' then return new; end if;
  -- Existing receivables must still settle through receipts and return credits.
  -- Creation, reactivation and source changes always revalidate the shipment.
  if tg_op='UPDATE' and old.status is distinct from 'cancelled'
    and new.company_id is not distinct from old.company_id and new.order_id is not distinct from old.order_id
    and new.dispatch_id is not distinct from old.dispatch_id and new.customer_id is not distinct from old.customer_id then return new; end if;
  if not private.invoice_dispatch_is_billable(new.company_id,new.order_id,new.dispatch_id) then
    raise exception 'Invoice dispatch is unavailable: returned/damaged or unverified retained shipment. Review its source and cancellation history' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_invoice_dispatch_billable() from public,anon,authenticated;
drop trigger if exists validate_invoice_dispatch_billable on public.invoices;
create trigger validate_invoice_dispatch_billable before insert or update of company_id,order_id,dispatch_id,status on public.invoices
for each row execute function public.validate_invoice_dispatch_billable();

create or replace function public.get_invoice_source_options(
  p_kind text,p_search text default '',p_order_id uuid default null,p_invoice_id uuid default null,p_selected_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path=public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoice sources' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('order','dispatch') or length(v_search)>100 or (p_kind='dispatch' and p_order_id is null) then
    raise exception 'Invalid invoice source request' using errcode='22023';
  end if;
  if p_invoice_id is not null then
    select * into v_invoice from public.invoices where id=p_invoice_id and company_id=v_company;
    if not found or v_invoice.status is null or v_invoice.status not in ('draft','generated') or coalesce(v_invoice.amount_paid,0)<>0 then
      raise exception 'Invoice source is unavailable or financially locked' using errcode='42501';
    end if;
    if (p_kind='dispatch' and p_order_id is distinct from v_invoice.order_id)
      or (p_selected_id is not null and p_selected_id is distinct from case when p_kind='order' then v_invoice.order_id else v_invoice.dispatch_id end) then
      raise exception 'An existing invoice must retain its original order and dispatch' using errcode='23514';
    end if;
  end if;
  if p_kind='order' then
    return (
      with matches as materialized (
        select source_order.id,source_order.order_number,source_order.customer_id,source_order.current_stage,source_order.order_value,
          customer.customer_name,customer.company_name,source_order.order_date
        from public.orders source_order join public.customers customer on customer.id=source_order.customer_id and customer.company_id=v_company
        where source_order.company_id=v_company and source_order.deleted_at is null
          and (p_invoice_id is null or source_order.id=v_invoice.order_id)
          and (p_selected_id is null or source_order.id=p_selected_id)
          and (v_search='' or strpos(lower(concat_ws(' ',source_order.order_number,customer.customer_name,customer.company_name)),v_search)>0)
          and exists(
            select 1 from public.dispatches dispatch_record
            where dispatch_record.company_id=v_company and dispatch_record.order_id=source_order.id
              and (p_invoice_id is null or dispatch_record.id=v_invoice.dispatch_id)
              and private.invoice_dispatch_is_billable(v_company,source_order.id,dispatch_record.id)
              and exists(select 1 from public.packing_list_items packing where packing.company_id=v_company and packing.dispatch_id=dispatch_record.id)
              and not exists(select 1 from public.invoices used where used.company_id=v_company and used.dispatch_id=dispatch_record.id and used.status<>'cancelled'
                and (p_invoice_id is null or used.id<>p_invoice_id))
          )
        order by source_order.order_date desc nulls last,source_order.id limit 26
      ), visible as (select * from matches order by order_date desc nulls last,id limit 25)
      select jsonb_build_object('kind','order','has_more',(select count(*)>25 from matches),'rows',
        coalesce((select jsonb_agg(to_jsonb(visible)-'order_date' order by order_date desc nulls last,id) from visible),'[]'::jsonb))
    );
  end if;
  if not exists(select 1 from public.orders where id=p_order_id and company_id=v_company and deleted_at is null) then
    raise exception 'Invoice source order is unavailable' using errcode='42501';
  end if;
  return (
    with matches as materialized (
      select dispatch_record.id,dispatch_record.order_id,dispatch_record.dispatch_number,dispatch_record.dispatch_date,
        dispatch_record.delivery_status,dispatch_record.total_weight_kg
      from public.dispatches dispatch_record
      where dispatch_record.company_id=v_company and dispatch_record.order_id=p_order_id
        and (p_invoice_id is null or dispatch_record.id=v_invoice.dispatch_id)
        and (p_selected_id is null or dispatch_record.id=p_selected_id)
        and (v_search='' or strpos(lower(concat_ws(' ',dispatch_record.dispatch_number,dispatch_record.delivery_status)),v_search)>0)
        and private.invoice_dispatch_is_billable(v_company,p_order_id,dispatch_record.id)
        and exists(select 1 from public.packing_list_items packing where packing.company_id=v_company and packing.dispatch_id=dispatch_record.id)
        and not exists(select 1 from public.invoices used where used.company_id=v_company and used.dispatch_id=dispatch_record.id and used.status<>'cancelled'
          and (p_invoice_id is null or used.id<>p_invoice_id))
      order by dispatch_record.dispatch_date desc nulls last,dispatch_record.id limit 26
    ), visible as (select * from matches order by dispatch_date desc nulls last,id limit 25)
    select jsonb_build_object('kind','dispatch','has_more',(select count(*)>25 from matches),'rows',
      coalesce((select jsonb_agg(to_jsonb(visible) order by dispatch_date desc nulls last,id) from visible),'[]'::jsonb))
  );
end;
$$;
revoke all on function public.get_invoice_source_options(text,text,uuid,uuid,uuid) from public,anon;
grant execute on function public.get_invoice_source_options(text,text,uuid,uuid,uuid) to authenticated;

create or replace function private.save_invoice_atomic(p_invoice_id uuid,p_invoice jsonb,p_items jsonb,p_replace_items boolean)
returns uuid language plpgsql security definer set search_path=public,private as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_requested_customer_id uuid := nullif(p_invoice->>'customer_id','')::uuid;
  v_order_id uuid := nullif(p_invoice->>'order_id','')::uuid;
  v_dispatch_id uuid := nullif(p_invoice->>'dispatch_id','')::uuid;
  v_order public.orders%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_requested_status text := coalesce(nullif(p_invoice->>'status',''),'draft');
  v_invoice_prefix text := 'INV';
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode='42501'; end if;
  if v_order_id is null then raise exception 'Select the source order for this invoice'; end if;
  if v_dispatch_id is null then raise exception 'Select a packed dispatch. Tax invoices cannot bill an order directly.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Invoice items must be an array'; end if;

  select * into v_order from public.orders where id=v_order_id and company_id=v_company_id for share nowait;
  if not found then raise exception 'Order not found for this company'; end if;
  if v_requested_customer_id is not null and v_requested_customer_id<>v_order.customer_id then raise exception 'Invoice customer must match the source order customer'; end if;
  if not exists(select 1 from public.customers where id=v_order.customer_id and company_id=v_company_id) then raise exception 'Order customer not found for this company'; end if;

  -- Return/damage and cancellation cannot change while this save uses the manifest.
  -- Fail fast rather than waiting on a delivery writer that may need the order.
  if not pg_try_advisory_xact_lock(hashtextextended('dispatch-invoice:'||v_company_id::text||':'||v_dispatch_id::text,0)) then
    raise exception 'Invoice manifest is being changed. Refresh and retry' using errcode='55P03';
  end if;
  select * into v_dispatch from public.dispatches where id=v_dispatch_id and company_id=v_company_id and order_id=v_order_id for update nowait;
  if not found then raise exception 'Dispatch must belong to the selected order and company'; end if;
  if v_dispatch.delivery_status in ('returned','damaged') then raise exception 'Returned or damaged dispatches cannot be invoiced; resolve the return or create a replacement dispatch first' using errcode='23514'; end if;
  if not private.invoice_dispatch_is_billable(v_company_id,v_order_id,v_dispatch_id) then
    raise exception 'Only verified shipments recorded before cancellation can be invoiced for this order' using errcode='23514';
  end if;
  if exists(select 1 from public.invoices where company_id=v_company_id and dispatch_id=v_dispatch_id and status<>'cancelled'
    and (p_invoice_id is null or id<>p_invoice_id)) then raise exception 'This dispatch already has an active invoice'; end if;

  if p_invoice_id is null then
    if v_requested_status not in ('draft','generated') then raise exception 'New invoices can only start as draft or generated'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'An invoice requires at least one source line'; end if;
  else
    select * into v_existing from public.invoices where id=p_invoice_id and company_id=v_company_id for update nowait;
    if not found then raise exception 'Invoice not found for this company'; end if;
    if v_existing.status is null or v_existing.status not in ('draft','generated') or coalesce(v_existing.amount_paid,0)<>0 then raise exception 'Only unpaid draft or generated invoices can be edited'; end if;
    if v_requested_status not in ('draft','generated','sent') then raise exception 'Use the receipt workflow to change a financial invoice status'; end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Editing an invoice requires its source lines to be regenerated'; end if;
  end if;

  select coalesce(nullif(invoice_prefix,''),'INV') into v_invoice_prefix from public.company_settings where company_id=v_company_id limit 1;
  v_invoice_prefix := coalesce(v_invoice_prefix,'INV');
  v_payload := private.keep_jsonb_keys(p_invoice,array['invoice_number','invoice_date','due_date','status','notes','place_of_supply_state_code'])
    ||jsonb_build_object('company_id',v_company_id,'customer_id',v_order.customer_id,'order_id',v_order_id,'dispatch_id',v_dispatch_id,
      'subtotal',0,'tax_total',0,'grand_total',0,'amount_paid',0,'paid_date',null,'status',v_requested_status);
  if p_invoice_id is null then
    if nullif(v_payload->>'invoice_number','') is null then
      v_payload := v_payload||jsonb_build_object('invoice_number',private.next_business_number_locked('public.invoices'::regclass,'invoice_number',v_company_id,
        v_invoice_prefix,coalesce(nullif(v_payload->>'invoice_date','')::date,current_date)));
    end if;
    v_invoice_id := private.insert_jsonb_row('public.invoices'::regclass,v_payload||jsonb_build_object('created_by',auth.uid()));
  else
    v_invoice_id := private.update_jsonb_row('public.invoices'::regclass,p_invoice_id,v_company_id,(v_payload-'invoice_number')||jsonb_build_object('updated_at',now()));
  end if;
  delete from public.invoice_items where invoice_id=v_invoice_id and company_id=v_company_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    perform private.insert_jsonb_row('public.invoice_items'::regclass,
      (v_item-array['id','company_id','invoice_id','created_at','updated_at'])||jsonb_build_object('company_id',v_company_id,'invoice_id',v_invoice_id,'created_at',now(),'updated_at',now()));
  end loop;
  perform private.recalculate_invoice_totals(v_invoice_id,v_company_id);
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company_id,auth.uid(),case when p_invoice_id is null then 'invoice_created' else 'invoice_updated' end,'invoice',v_invoice_id,
    jsonb_build_object('order_id',v_order_id,'dispatch_id',v_dispatch_id,'customer_id',v_order.customer_id,'status',v_requested_status,
      'retained_after_cancellation',v_order.current_stage='cancelled'));
  return v_invoice_id;
exception when lock_not_available then
  raise exception 'Invoice source is being changed. Refresh and retry' using errcode='55P03';
end;
$$;
revoke all on function private.save_invoice_atomic(uuid,jsonb,jsonb,boolean) from public,anon,authenticated;

create or replace function private.replace_invoice_items_atomic(p_invoice_id uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or v_company is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('owner','admin','accounts') then raise exception 'Permission denied for invoices' using errcode='42501'; end if;
  select * into v_invoice from public.invoices where id=p_invoice_id and company_id=v_company;
  if not found then raise exception 'Invoice not found for this company'; end if;
  if v_invoice.status is null or v_invoice.status not in ('draft','generated') or coalesce(v_invoice.amount_paid,0)<>0 then raise exception 'Only unpaid draft or generated invoices can regenerate source lines'; end if;
  -- Use the same locked source eligibility, lineage, coverage and audit path.
  return private.save_invoice_atomic(p_invoice_id,to_jsonb(v_invoice),p_items,true);
end;
$$;
revoke all on function private.replace_invoice_items_atomic(uuid,jsonb) from public,anon,authenticated;

create or replace function public.save_invoice_atomic(p_invoice_id uuid,p_invoice jsonb,p_items jsonb,p_replace_items boolean)
returns uuid language sql security definer set search_path=public,private as $$select private.save_invoice_atomic(p_invoice_id,p_invoice,p_items,p_replace_items)$$;
create or replace function public.replace_invoice_items_atomic(p_invoice_id uuid,p_items jsonb)
returns uuid language sql security definer set search_path=public,private as $$select private.replace_invoice_items_atomic(p_invoice_id,p_items)$$;
revoke all on function public.save_invoice_atomic(uuid,jsonb,jsonb,boolean),public.replace_invoice_items_atomic(uuid,jsonb) from public,anon;
grant execute on function public.save_invoice_atomic(uuid,jsonb,jsonb,boolean),public.replace_invoice_items_atomic(uuid,jsonb) to authenticated;

commit;

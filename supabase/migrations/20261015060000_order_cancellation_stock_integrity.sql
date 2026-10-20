-- Prepared only. Cancellation releases commitments; a physical return needs a receipt.
begin;

create or replace function public.credit_dealer_stock_on_order_cancel()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_ledger jsonb;
  v_released_count integer;
begin
  if tg_op<>'UPDATE' or new.current_stage is distinct from 'cancelled' or old.current_stage='cancelled' then return new; end if;
  if auth.uid() is null or v_company is null or v_role is null or v_role not in ('owner','admin')
    or new.company_id is distinct from v_company or old.company_id is distinct from new.company_id or old.id is distinct from new.id then
    raise exception 'Only active company owners and admins may cancel an order' using errcode='42501';
  end if;

  -- The parent UPDATE holds the order lock. Do not wait on a dispatch that
  -- already owns a reservation and may subsequently need this same order.
  perform 1 from public.profile_stock_reservations reservation
  where reservation.company_id=v_company and reservation.order_id=new.id and reservation.status='active'
  order by reservation.profile_stock_batch_id,reservation.id for update nowait;

  v_ledger := private.profile_stock_reservation_ledger_page(1,'','','created_at','desc',new.id);
  if (v_ledger->>'integrity_ok')::boolean is distinct from true then
    raise exception 'Reservation integrity is unavailable. Reconcile this order before cancellation' using errcode='23514';
  end if;

  update public.profile_stock_reservations set status='cancelled',released_at=now()
  where company_id=v_company and order_id=new.id and status='active';
  get diagnostics v_released_count = row_count;

  insert into public.order_stage_history(company_id,order_id,stage,changed_by,remarks)
  values(v_company,new.id,'cancelled',auth.uid(),
    'Order cancelled and unconsumed reservation holds released. Posted fulfillment remains unchanged; physical returns require a recorded receipt.');
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,metadata_json)
  values(v_company,auth.uid(),'order_cancelled_hold_release','order',new.id,
    jsonb_build_object('released_reservation_count',v_released_count,
      'released_weight_kg',(v_ledger->'summary'->>'open_weight_kg')::numeric,
      'physical_stock_changed',false,'previous_stage',old.current_stage));
  return new;
exception when lock_not_available then
  raise exception 'Order reservations are being changed. Refresh and retry cancellation' using errcode='55P03';
end;
$$;
revoke all on function public.credit_dealer_stock_on_order_cancel() from public,anon,authenticated;

drop trigger if exists credit_dealer_stock_on_order_cancel_trigger on public.orders;
create trigger credit_dealer_stock_on_order_cancel_trigger after update of current_stage on public.orders
for each row execute function public.credit_dealer_stock_on_order_cancel();

create or replace function private.guard_cancelled_order_reservations()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_stage text;
begin
  if new.status is distinct from 'active' then return new; end if;
  -- Serialize new holds with cancellation. NOWAIT avoids row/order lock inversion
  -- when a direct reservation UPDATE has already locked its own row.
  select current_stage into v_stage from public.orders
  where id=new.order_id and company_id=new.company_id for update nowait;
  if not found then raise exception 'Reservation order is unavailable' using errcode='23514'; end if;
  if v_stage='cancelled' then raise exception 'A cancelled order cannot acquire active stock reservations' using errcode='23514'; end if;
  return new;
exception when lock_not_available then
  raise exception 'Reservation order is being changed. Refresh and retry' using errcode='55P03';
end;
$$;
revoke all on function private.guard_cancelled_order_reservations() from public,anon,authenticated;

-- This name places the order eligibility lock before the existing batch-capacity trigger.
drop trigger if exists aa_guard_cancelled_order_reservations on public.profile_stock_reservations;
create trigger aa_guard_cancelled_order_reservations before insert or update of company_id,order_id,status on public.profile_stock_reservations
for each row execute function private.guard_cancelled_order_reservations();

commit;

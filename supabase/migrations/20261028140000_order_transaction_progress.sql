-- EOS 34: aggregate confirmed evidence in one database snapshot; do not infer quality release.
begin;
create function public.order_transaction_progress(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,private as $$
declare v_company uuid;v_order public.orders%rowtype;v_produced numeric;v_production_ok boolean;v_outward numeric;v_dispatch_ok boolean;
  v_returns numeric;v_holds integer;v_finance jsonb;
begin
  v_company:=private.commercial_actor(array['owner','admin','sales','sales_manager','production_manager','production','factory_manager','inventory_manager','dispatch_manager','dispatch','quality','accounts','viewer']);
  select * into v_order from public.orders where company_id=v_company and id=p_order_id and deleted_at is null;
  if not found then raise exception 'Order is unavailable'; end if;
  select coalesce(sum(actual_quantity_kg),0),coalesce(bool_and(actual_quantity_kg is not null and actual_quantity_kg>=0 and actual_quantity_kg::text not in ('NaN','Infinity','-Infinity')),true)
    into v_produced,v_production_ok from public.production_jobs where company_id=v_company and order_id=p_order_id and status='completed';
  with shipped as (
    select d.id,d.total_weight_kg,d.actual_dispatched_at,p.weight,p.valid,p.n from public.dispatches d left join lateral(
      select sum(net_weight_kg) weight,count(*) n,bool_and(net_weight_kg is not null and net_weight_kg>0 and net_weight_kg::text not in ('NaN','Infinity','-Infinity')
        and operator_verified_by is not null and operator_verified_at is not null and operator_verified_at<=d.actual_dispatched_at) valid
      from public.packing_list_items where company_id=v_company and dispatch_id=d.id)p on true
    where d.company_id=v_company and d.order_id=p_order_id and d.actual_dispatched_at is not null
  ) select coalesce(sum(weight),0),coalesce(bool_and(coalesce(n>0 and valid and total_weight_kg is not null and abs(weight-total_weight_kg)<=0.001
    and actual_dispatched_at<=now() and actual_dispatched_at::text not in ('infinity','-infinity'),false)),true) into v_outward,v_dispatch_ok from shipped;
  select coalesce(sum(m.weight_kg),0) into v_returns from public.material_dispositions m join public.dispatches d on d.id=m.dispatch_id and d.company_id=m.company_id
    where m.company_id=v_company and d.order_id=p_order_id and m.source_type='dispatch_return' and m.disposition<>'quarantine';
  select count(*) into v_holds from public.quality_inspections q join public.production_jobs j on j.id=q.production_job_id and j.company_id=q.company_id
    where q.company_id=v_company and j.order_id=p_order_id and q.status in ('rejected','rework');
  if private.get_current_user_role() in ('owner','admin','accounts') then
    select jsonb_build_object('billed',coalesce(sum(grand_total),0),'receipts_net',coalesce(sum(amount_paid),0),'credits',coalesce(sum(credited_amount),0),
      'receivable',coalesce(sum(balance_due),0),'customer_credit_due',coalesce(sum(customer_credit_due),0),'invoice_count',count(*)) into v_finance
      from public.invoices where company_id=v_company and order_id=p_order_id and status not in ('draft','cancelled') and deleted_at is null;
  end if;
  return jsonb_build_object('order_id',p_order_id,'order_number',v_order.order_number,'calculated_at',now(),
    'produced_kg',case when v_production_ok then v_produced else null end,'production_evidence_complete',v_production_ok,
    'confirmed_outward_kg',case when v_dispatch_ok then v_outward else null end,'dispatch_evidence_complete',v_dispatch_ok,
    'recorded_returns_kg',v_returns,'net_outward_kg',case when v_dispatch_ok and v_returns<=v_outward then v_outward-v_returns else null end,
    'quality_exceptions',v_holds,'current_stage',v_order.current_stage,
    'basis','Completed actual production; verified packing on shipments with a recorded departure; non-quarantine return dispositions. Status alone never subtracts a physical return. Quality decisions remain independent.')
    || case when v_finance is not null then jsonb_build_object('financials',v_finance) else '{}'::jsonb end;
end;
$$;
revoke all on function public.order_transaction_progress(uuid) from public,anon;
grant execute on function public.order_transaction_progress(uuid) to authenticated;
commit;

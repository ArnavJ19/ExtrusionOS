begin;
create table public.connected_return_receipts (
  id uuid primary key,company_id uuid not null references public.companies(id),packing_list_item_id uuid not null references public.packing_list_items(id),
  dispatch_id uuid not null references public.dispatches(id),order_id uuid not null references public.orders(id),order_item_id uuid references public.order_items(id),
  received_kg numeric(15,3) not null check(received_kg>0),received_pieces integer not null check(received_pieces>0),received_metres numeric(15,3) not null check(received_metres>0),
  received_by uuid not null references public.app_users(id),received_at timestamptz not null default clock_timestamp(),reason text not null,
  status text not null default 'received' check(status in ('received','inspected','disposed')),
  inspected_by uuid references public.app_users(id),inspection_note text,disposition text check(disposition in ('rework','scrap','return_to_stock','scrap_sale','write_off')),
  disposition_id uuid unique references public.material_dispositions(id),credit_note_id uuid unique references public.credit_notes(id),rework_task_id uuid references public.tasks(id),
  source_snapshot jsonb not null,request_payload jsonb not null,check(inspected_by is null or inspected_by<>received_by)
);
create index return_receipts_company_dispatch on public.connected_return_receipts(company_id,dispatch_id,received_at,id);
create index return_receipts_packing on public.connected_return_receipts(company_id,packing_list_item_id);
alter table public.connected_return_receipts enable row level security;
revoke all on public.connected_return_receipts from public,anon,authenticated;
create table private.return_disposition_authorizations(transaction_id bigint not null,receipt_id uuid not null references public.connected_return_receipts(id),primary key(transaction_id,receipt_id));
revoke all on private.return_disposition_authorizations from public,anon,authenticated;
create table private.return_credit_authorizations(transaction_id bigint not null,receipt_id uuid not null references public.connected_return_receipts(id),primary key(transaction_id,receipt_id));
revoke all on private.return_credit_authorizations from public,anon,authenticated;

create function public.connected_return_command(p_command text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,private as $$
declare c uuid;r public.connected_return_receipts;p public.packing_list_items;d public.dispatches;v_role text;v_kg numeric;v_pieces numeric;v_metres numeric;v_used numeric;v_used_p numeric;v_used_m numeric;v_id uuid;v_stock uuid;v_task uuid;rows jsonb;v_page int:=coalesce((p_payload->>'page')::int,1);inv public.invoices;ii public.invoice_items;v_credit uuid;v_sub numeric;v_tax numeric;
begin
  c:=private.commercial_actor(array['owner','admin','dispatch_manager','inventory_manager','quality','accounts']);v_role:=private.get_current_user_role();
  if p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or v_page not between 1 and 10000 then raise exception 'Invalid return request'; end if;
  if p_command='returns.list' then
    if p_payload-array['page','order_id','dispatch_id']<>'{}' then raise exception 'Invalid return list'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select id,order_id,order_item_id,dispatch_id,packing_list_item_id,received_kg,received_pieces,received_metres,received_by,received_at,status,inspection_note,disposition,disposition_id,credit_note_id,rework_task_id,reason,source_snapshot->>'bundle_number' bundle_number from public.connected_return_receipts where company_id=c and (nullif(p_payload->>'order_id','') is null or order_id=(p_payload->>'order_id')::uuid) and (nullif(p_payload->>'dispatch_id','') is null or dispatch_id=(p_payload->>'dispatch_id')::uuid) order by received_at desc,id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','returns','page',v_page,'items',rows);
  end if;
  if p_command='sources.list' then
    if p_payload-array['dispatch_id','page']<>'{}' then raise exception 'Invalid return sources'; end if;
    perform 1 from public.dispatches where id=(p_payload->>'dispatch_id')::uuid and company_id=c and delivery_status in ('delivered','returned','damaged') and actual_dispatched_at is not null;if not found then raise exception 'A departed delivered, returned or damaged dispatch is required'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select p.id,p.bundle_number,p.net_weight_kg,p.number_of_pieces,p.order_item_id,coalesce((select sum(received_kg) from public.connected_return_receipts where company_id=c and packing_list_item_id=p.id),0) received_kg from public.packing_list_items p where p.company_id=c and p.dispatch_id=(p_payload->>'dispatch_id')::uuid order by p.id limit 10 offset (v_page-1)*10)x;
    return jsonb_build_object('kind','sources','page',v_page,'items',rows);
  end if;
  v_id:=(p_payload->>'id')::uuid;
  if p_command='return.receive' then
    if v_role='accounts' or p_payload-array['id','packing_list_item_id','received_kg','received_pieces','received_metres','reason']<>'{}' then raise exception 'Return receiving is not permitted'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c::text||':return:'||v_id::text,0));
    select * into r from public.connected_return_receipts where id=v_id;
    if found then if r.company_id<>c or r.request_payload<>p_payload then raise exception 'Return receipt identity has different observations'; end if;return jsonb_build_object('kind','saved','id',r.id,'replayed',true);end if;
    select * into p from public.packing_list_items where id=(p_payload->>'packing_list_item_id')::uuid and company_id=c;
    if not found then raise exception 'Packing source is unavailable'; end if;
    select * into d from public.dispatches where id=p.dispatch_id and company_id=c for update;
    if not found or d.delivery_status not in ('delivered','returned','damaged') or d.actual_dispatched_at is null then raise exception 'A departed delivered, returned or damaged dispatch is required'; end if;
    perform 1 from public.packing_list_items where id=p.id for update;
    v_kg:=(p_payload->>'received_kg')::numeric;v_pieces:=(p_payload->>'received_pieces')::numeric;v_metres:=(p_payload->>'received_metres')::numeric;
    if v_kg is null or v_pieces is null or v_metres is null or v_metres::text in ('NaN','Infinity','-Infinity') or v_kg::text in ('NaN','Infinity','-Infinity') or v_pieces::text in ('NaN','Infinity','-Infinity') or v_kg<=0 or v_kg<>round(v_kg,3) or v_pieces<=0 or v_pieces<>trunc(v_pieces) or v_metres<=0 or v_metres<>round(v_metres,3) or length(btrim(coalesce(p_payload->>'reason',''))) not between 8 and 1000 then raise exception 'Capture the actual positive return weight, whole pieces, metres and reason'; end if;
    select coalesce(sum(received_kg),0),coalesce(sum(received_pieces),0),coalesce(sum(received_metres),0) into v_used,v_used_p,v_used_m from public.connected_return_receipts where company_id=c and packing_list_item_id=p.id;
    -- Earlier disposition-only returns count too; the new case's own disposition is counted once.
    select v_used+coalesce(sum(m.weight_kg),0),v_used_p+coalesce(sum(m.pieces),0) into v_used,v_used_p from public.material_dispositions m where m.company_id=c and m.packing_list_item_id=p.id and m.disposition<>'quarantine' and not exists(select 1 from public.connected_return_receipts x where x.disposition_id=m.id);
    if exists(select 1 from public.material_dispositions m where m.company_id=c and m.packing_list_item_id=p.id and m.disposition<>'quarantine' and m.pieces is null and not exists(select 1 from public.connected_return_receipts x where x.disposition_id=m.id)) then raise exception 'Legacy return pieces must be reconciled before receiving another portion';end if;
    if p.net_weight_kg is null or p.number_of_pieces is null or p.net_length_m is null or v_used+v_kg>p.net_weight_kg+0.001 or v_used_p+v_pieces>p.number_of_pieces or v_used_m+v_metres>p.net_length_m+0.001 then raise exception 'Cumulative returns exceed the original shipped weight, pieces or metres'; end if;
    insert into public.connected_return_receipts(id,company_id,packing_list_item_id,dispatch_id,order_id,order_item_id,received_kg,received_pieces,received_metres,received_by,reason,source_snapshot,request_payload) values(v_id,c,p.id,d.id,d.order_id,p.order_item_id,v_kg,v_pieces::int,v_metres,auth.uid(),btrim(p_payload->>'reason'),jsonb_build_object('bundle_number',p.bundle_number,'profile_id',p.profile_id,'source_kind',p.source_kind,'source_line_id',p.source_line_id,'net_weight_kg',p.net_weight_kg,'number_of_pieces',p.number_of_pieces,'net_length_m',p.net_length_m),p_payload);
    return jsonb_build_object('kind','saved','id',v_id,'replayed',false);
  end if;
  select * into r from public.connected_return_receipts where id=v_id and company_id=c for update;
  if not found then raise exception 'Return receipt is unavailable'; end if;
  if p_command='return.inspect' then
    if v_role not in ('owner','admin','quality') or r.received_by=auth.uid() or p_payload-array['id','disposition','note']<>'{}' or r.status<>'received' then raise exception 'Another quality reviewer must inspect the received material'; end if;
    if p_payload->>'disposition' is null or p_payload->>'disposition' not in ('rework','scrap','return_to_stock','scrap_sale','write_off') or length(btrim(coalesce(p_payload->>'note',''))) not between 8 and 1000 then raise exception 'Record the inspected disposition and findings'; end if;
    update public.connected_return_receipts set status='inspected',inspected_by=auth.uid(),inspection_note=btrim(p_payload->>'note'),disposition=p_payload->>'disposition' where id=r.id;
  elsif p_command='return.dispose' then
    if v_role not in ('owner','admin','quality','inventory_manager','dispatch_manager') or p_payload-array['id']<>'{}' or r.status not in ('inspected','disposed') then raise exception 'Inspect the return before disposition'; end if;
    if r.disposition_id is null then
      insert into private.return_disposition_authorizations(transaction_id,receipt_id) values(txid_current(),r.id);
      if r.disposition='return_to_stock' then
        select * into p from public.packing_list_items where id=r.packing_list_item_id and company_id=c;
        perform 1 from public.dispatches where id=r.dispatch_id and company_id=c for update;
        perform 1 from public.packing_list_items where id=p.id for update;
        select coalesce(sum(weight_kg),0) into v_used from public.material_dispositions where company_id=c and packing_list_item_id=p.id and disposition<>'quarantine';
        if v_used+r.received_kg>p.net_weight_kg+0.001 then raise exception 'This returned material was already dispositioned'; end if;
        if abs(r.received_metres/r.received_pieces-p.net_length_m/p.number_of_pieces)>0.001 or round(r.received_metres/r.received_pieces,3)*r.received_pieces<>r.received_metres then raise exception 'Changed or unrepresentable cut lengths require the cutting/rework workflow before stock release'; end if;
        insert into public.profile_stock_batches(company_id,profile_id,finish,length_m,piece_length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,source_dispatch_id,alloy,temper,qc_status,origin_reference,notes)
          select c,p.profile_id,coalesce(p.finishing_type,'mill_finish'),r.received_metres,r.received_metres/r.received_pieces,r.received_pieces,r.received_kg,p.bundle_number||'-RETURN','Returns bay','available','customer_return',r.dispatch_id,ap.alloy,ap.temper,'on_hold','Return receipt '||r.id::text,r.inspection_note from public.aluminium_profiles ap where ap.id=p.profile_id and ap.company_id=c returning id into v_stock;
        insert into public.material_dispositions(company_id,source_type,dispatch_id,packing_list_item_id,profile_id,disposition,weight_kg,pieces,profile_stock_batch_id,reason,decided_by,decided_by_role)
          values(c,'dispatch_return',r.dispatch_id,p.id,p.profile_id,r.disposition,r.received_kg,r.received_pieces,v_stock,r.reason||' / Inspection: '||r.inspection_note,auth.uid(),v_role) returning id into v_id;
      else
        v_id:=private.record_material_disposition('dispatch_return',r.dispatch_id,r.packing_list_item_id,r.disposition,r.received_kg,r.received_pieces,r.reason||' / Inspection: '||r.inspection_note);
      end if;
      if r.disposition='rework' then insert into public.tasks(company_id,task_type,title,description,status,priority,related_entity_type,related_entity_id,created_by) values(c,'general','Review returned material for rework','Return receipt '||r.id::text||'; original dispatch '||r.dispatch_id::text||'. Record actual rework separately; no automatic stock or financial adjustment.','open','high','order',r.order_id,auth.uid()) returning id into v_task; end if;
      update public.connected_return_receipts set status='disposed',disposition_id=v_id,rework_task_id=v_task where id=r.id;
      delete from private.return_disposition_authorizations where transaction_id=txid_current() and receipt_id=r.id;
    end if;
  elsif p_command='return.credit' then
    if v_role not in ('owner','admin','accounts') or p_payload-array['id']<>'{}' or r.status<>'disposed' then raise exception 'Finance can credit only an inspected, dispositioned return'; end if;
    if r.credit_note_id is not null then return jsonb_build_object('kind','saved','id',r.id,'replayed',true); end if;
    select * into d from public.dispatches where id=r.dispatch_id and company_id=c for update;
    select * into inv from public.invoices where dispatch_id=r.dispatch_id and company_id=c and deleted_at is null and status not in ('draft','cancelled') for update;
    if not found then raise exception 'An issued invoice is required for a separate financial adjustment'; end if;
    select * into ii from public.invoice_items where invoice_id=inv.id and company_id=c and source_line_id=r.packing_list_item_id;
    if not found or ii.quantity is null or ii.quantity<=0 then raise exception 'The exact invoiced material line is unavailable'; end if;
    if exists(select 1 from public.credit_notes n where n.company_id=c and n.invoice_id=inv.id and n.status='issued' and not exists(select 1 from public.credit_note_packing_lines x where x.credit_note_id=n.id)) then raise exception 'The invoice already has a full credit'; end if;
    select coalesce(sum(x.quantity_kg),0) into v_used from public.credit_note_packing_lines x join public.credit_notes n on n.id=x.credit_note_id where x.company_id=c and x.packing_list_item_id=r.packing_list_item_id and n.status='issued';
    if v_used+r.received_kg>ii.quantity+0.001 then raise exception 'Return credit exceeds the remaining invoiced quantity'; end if;
    v_sub:=round(ii.line_total*r.received_kg/ii.quantity,2);v_tax:=round(v_sub*coalesce(ii.gst_percent,0)/100,2);
    if coalesce((select sum(grand_total) from public.credit_notes where company_id=c and invoice_id=inv.id and status='issued'),0)+v_sub+v_tax>inv.grand_total+0.01 then raise exception 'Return credit exceeds the invoice balance of adjustments'; end if;
    insert into private.return_credit_authorizations(transaction_id,receipt_id) values(txid_current(),r.id);
    insert into public.credit_notes(company_id,invoice_id,dispatch_id,credit_note_number,credit_date,reason,subtotal,tax_total,grand_total,item_snapshot,idempotency_key,created_by)
      values(c,inv.id,d.id,private.next_business_number_locked('public.credit_notes'::regclass,'credit_note_number',c,'CN',(now() at time zone 'Asia/Kolkata')::date),(now() at time zone 'Asia/Kolkata')::date,r.reason,v_sub,v_tax,v_sub+v_tax,
        jsonb_build_array(jsonb_build_object('source_line_id',r.packing_list_item_id,'return_receipt_id',r.id,'quantity',r.received_kg,'unit_rate',ii.unit_rate,'line_total',v_sub,'gst_percent',ii.gst_percent,'profile_id',ii.profile_id)),r.id,auth.uid()) returning id into v_credit;
    insert into public.credit_note_packing_lines(company_id,credit_note_id,packing_list_item_id,invoice_item_id,quantity_kg,unit_rate,line_total,gst_percent,tax_amount) values(c,v_credit,r.packing_list_item_id,ii.id,r.received_kg,ii.unit_rate,v_sub,coalesce(ii.gst_percent,0),v_tax);
    update public.connected_return_receipts set credit_note_id=v_credit where id=r.id;
    update public.invoices set credited_amount=(select coalesce(sum(grand_total),0) from public.credit_notes where company_id=c and invoice_id=inv.id and status='issued') where id=inv.id;
    perform private.recalculate_invoice_collection_state(inv.id,c);
    delete from private.return_credit_authorizations where transaction_id=txid_current() and receipt_id=r.id;
  else raise exception 'Invalid return command'; end if;
  return jsonb_build_object('kind','saved','id',r.id,'replayed',false);
end $$;
revoke all on function public.connected_return_command(text,jsonb) from public,anon;
grant execute on function public.connected_return_command(text,jsonb) to authenticated;

create function private.guard_connected_return_disposition() returns trigger language plpgsql security definer set search_path=public,private as $$
declare p public.packing_list_items;v_used numeric;v_pieces numeric;
begin
  if new.source_type<>'dispatch_return' or new.disposition='quarantine' then return new;end if;
  perform 1 from public.dispatches where id=new.dispatch_id and company_id=new.company_id for update;
  select * into p from public.packing_list_items where id=new.packing_list_item_id and company_id=new.company_id and dispatch_id=new.dispatch_id for update;
  if not found or new.weight_kg is null or new.weight_kg<=0 or new.weight_kg::text in ('NaN','Infinity','-Infinity') or (new.disposition='return_to_stock' and coalesce(new.pieces,0)<=0) then raise exception 'A return disposition needs finite physical weight and actual returned stock pieces';end if;
  select coalesce(sum(weight_kg),0),coalesce(sum(pieces),0) into v_used,v_pieces from public.material_dispositions where company_id=new.company_id and packing_list_item_id=p.id and disposition<>'quarantine' and id<>new.id;
  if v_used+new.weight_kg>p.net_weight_kg+0.001 or v_pieces+coalesce(new.pieces,0)>p.number_of_pieces then raise exception 'Return disposition exceeds the original shipment weight or pieces';end if;
  if exists(select 1 from public.connected_return_receipts where company_id=new.company_id and packing_list_item_id=p.id) and not exists(
    select 1 from private.return_disposition_authorizations a join public.connected_return_receipts r on r.id=a.receipt_id where a.transaction_id=txid_current() and r.company_id=new.company_id and r.packing_list_item_id=p.id and r.status='inspected' and r.disposition=new.disposition and r.received_kg=new.weight_kg and r.received_pieces=new.pieces
  ) then raise exception 'Use the independently inspected connected return receipt for this material';end if;
  return new;
end $$;
revoke all on function private.guard_connected_return_disposition() from public,anon,authenticated;
create trigger guard_connected_return_disposition before insert or update on public.material_dispositions for each row execute function private.guard_connected_return_disposition();

create function private.guard_connected_return_credit() returns trigger language plpgsql security definer set search_path=public,private as $$
begin
  if exists(select 1 from public.connected_return_receipts where company_id=new.company_id and dispatch_id=new.dispatch_id) and not exists(
    select 1 from private.return_credit_authorizations a join public.connected_return_receipts r on r.id=a.receipt_id where a.transaction_id=txid_current() and r.company_id=new.company_id and r.dispatch_id=new.dispatch_id and r.status='disposed' and r.id=new.idempotency_key
  ) then raise exception 'Connected returns require a separate proportional credit from their inspected receipts';end if;
  return new;
end $$;
revoke all on function private.guard_connected_return_credit() from public,anon,authenticated;
create trigger guard_connected_return_credit before insert on public.credit_notes for each row execute function private.guard_connected_return_credit();

create function private.guard_return_credit_quantity() returns trigger language plpgsql security definer set search_path=public,private as $$
declare v_cap numeric;v_used numeric;v_company uuid;
begin
  select company_id into v_company from public.credit_notes where id=new.credit_note_id and company_id=new.company_id;
  if v_company is null then raise exception 'Credit note source is unavailable'; end if;
  perform 1 from public.packing_list_items where id=new.packing_list_item_id and company_id=new.company_id for update;
  select coalesce(sum(weight_kg),0) into v_cap from public.material_dispositions where company_id=new.company_id and packing_list_item_id=new.packing_list_item_id and disposition<>'quarantine';
  select coalesce(sum(x.quantity_kg),0) into v_used from public.credit_note_packing_lines x join public.credit_notes n on n.id=x.credit_note_id where x.company_id=new.company_id and x.packing_list_item_id=new.packing_list_item_id and n.status='issued' and x.id<>new.id;
  if new.quantity_kg is null or new.quantity_kg::text in ('NaN','Infinity','-Infinity') or new.quantity_kg<=0 or v_used+new.quantity_kg>v_cap+0.001 then raise exception 'Credited quantity cannot exceed physically dispositioned return evidence'; end if;
  return new;
end $$;
revoke all on function private.guard_return_credit_quantity() from public,anon,authenticated;
create trigger guard_return_credit_quantity before insert or update on public.credit_note_packing_lines for each row execute function private.guard_return_credit_quantity();
commit;

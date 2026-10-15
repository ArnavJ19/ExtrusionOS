import {existsSync,readFileSync} from "node:fs";
import {createDirectOrderFixture,fixtureId as id} from "./direct-order-fixture.mjs";
import {createHistoricalTables,sqlDefinition} from "./historical-schema-fixture.mjs";
import {installDispatchReservationLedgerObjects} from "./dispatch-reservation-ledger-fixture.mjs";

export const orderCancellationCandidate="20261015060000_order_cancellation_stock_integrity.sql";
const candidateUrl=new URL(`../../supabase/migrations/${orderCancellationCandidate}`,import.meta.url);
export const cancellationIds={company:id(1),sibling:id(2),actor:id(3),siblingActor:id(4),profile:id(20),dealer:id(200),
  order:id(300),otherOrder:id(301),dispatch:id(302),reservation:id(303),otherReservation:id(304),batch:id(305),
  fulfillment:id(306),quote:id(307),quoteLine:id(308),orderLine:id(309),inventory:id(310)};

export async function installOrderCancellationStockObjects(db){
  // Extract candidate objects only. Never execute a prepared migration wrapper.
  const source=readFileSync(candidateUrl,"utf8");
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(orderCancellationCandidate,name));
  for(const statement of source.match(/(?:drop trigger|create trigger|revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length,triggers:(source.match(/create trigger/g)??[]).length};
}

export async function createOrderCancellationStockFixture({candidate=existsSync(candidateUrl),stage="dispatched"}={}){
  const db=await createDirectOrderFixture();const f=cancellationIds;
  try{
    await createHistoricalTables(db,["profile_stock_batches","profile_stock_consumptions","inventory_items","inventory_transactions","system_configurations"],"20261015050000_dispatch_reservation_ledger.sql");
    await db.exec(`create function public.get_current_user_role() returns text language sql security definer as $$select private.get_current_user_role()$$;
      create function public.get_current_user_dealer_id() returns uuid language sql security definer as $$select private.get_current_user_dealer_id()$$;
      update app_users set role='owner' where id in ('${f.actor}','${f.siblingActor}');
      insert into quotes(id,company_id,customer_id,dealer_id,status,grand_total) values('${f.quote}','${f.company}','${id(10)}','${f.dealer}','converted_to_order',5000);
      insert into quote_items(id,company_id,quote_id,profile_id,billing_weight_kg,total_weight_kg,finishing_type,net_rate,price_per_kg,line_total_before_gst)
        values('${f.quoteLine}','${f.company}','${f.quote}','${f.profile}',50,50,'mill_finish',100,100,5000);
      insert into orders(id,company_id,customer_id,quote_id,dealer_id,current_stage,requested_weight_kg,dealer_fulfilled_weight_kg,manufacturing_weight_kg)
        values('${f.order}','${f.company}','${id(10)}','${f.quote}','${f.dealer}','${stage}',50,20,30),
          ('${f.otherOrder}','${f.company}','${id(10)}',null,null,'order_confirmed',20,0,20);
      insert into order_items(id,company_id,order_id,quote_item_id,profile_id,quantity_kg,dealer_fulfilled_weight_kg,manufacturing_weight_kg)
        values('${f.orderLine}','${f.company}','${f.order}','${f.quoteLine}','${f.profile}',50,20,30);
      insert into profile_stock_batches(id,company_id,dealer_id,profile_id,finish,bundle_number,total_weight_kg,length_m,quantity_pieces,status)
        values('${f.batch}','${f.company}','${f.dealer}','${f.profile}','mill_finish','B-PARTIAL',40,20,4,'reserved');
      insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,reserved_weight_kg,reserved_length_m,reserved_pieces,
        initial_reserved_weight_kg,initial_reserved_length_m,initial_reserved_pieces)
        values('${f.reservation}','${f.company}','${f.order}','${f.profile}','${f.batch}','active',30,15,3,30,15,3),
          ('${f.otherReservation}','${f.company}','${f.otherOrder}','${f.profile}','${f.batch}','active',20,10,2,20,10,2);
      insert into dispatches(id,company_id,order_id,delivery_status,total_weight_kg) values('${f.dispatch}','${f.company}','${f.order}','delivered',10);
      insert into profile_stock_consumptions(id,company_id,reservation_id,order_id,dispatch_id,profile_id,profile_stock_batch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
        values('${id(311)}','${f.company}','${f.reservation}','${f.order}','${f.dispatch}','${f.profile}','${f.batch}',10,5,1);
      insert into order_dealer_stock_fulfillments(id,company_id,order_id,quote_id,quote_item_id,order_item_id,profile_id,profile_stock_batch_id,
        finishing_type,fulfilled_weight_kg,fulfilled_length_m,fulfilled_pieces,unit_rate,quoted_line_value)
        values('${f.fulfillment}','${f.company}','${f.order}','${f.quote}','${f.quoteLine}','${f.orderLine}','${f.profile}','${f.batch}','mill_finish',20,10,2,100,5000);
      insert into inventory_items(id,company_id,item_code) values('${f.inventory}','${f.company}','P-001');
      insert into inventory_transactions(company_id,inventory_item_id,item_type,quantity,unit,order_id,reason,status)
        values('${f.company}','${f.inventory}','profile',-20,'kg','${f.order}','Existing dealer stock debit','posted');`);
    for(const [file,names] of [
      ["20261008020000_factory_workflow_integrity.sql",["private.guard_profile_reservation_capacity","private.guard_reserved_stock_capacity"]],
      ["20260721091620_quote_atomic_dealer_lineage.sql",["private.enforce_dealer_fulfillment_lineage"]],
      ["0041_dealer_roles_inventory_automation.sql",["public.credit_dealer_stock_on_order_cancel"]]
    ])for(const name of names)await db.exec(sqlDefinition(file,name));
    await installDispatchReservationLedgerObjects(db);
    await db.exec(`create trigger astra_reservation_capacity before insert or update on profile_stock_reservations for each row execute function private.guard_profile_reservation_capacity();
      create trigger astra_reserved_stock before update on profile_stock_batches for each row execute function private.guard_reserved_stock_capacity();
      create trigger enforce_dealer_fulfillment_lineage before insert or update of company_id,order_id,quote_id,quote_item_id,order_item_id,profile_id,profile_stock_batch_id,finishing_type,unit_rate,quoted_line_value
        on order_dealer_stock_fulfillments for each row execute function private.enforce_dealer_fulfillment_lineage();
      create trigger credit_dealer_stock_on_order_cancel_trigger after update of current_stage on orders for each row execute function public.credit_dealer_stock_on_order_cancel();
      grant all on all tables in schema public to authenticated;
      alter table orders enable row level security;
      create policy fixture_cancellation_orders on orders for all using(company_id=private.get_current_user_company_id()) with check(company_id=private.get_current_user_company_id());
      alter table profile_stock_reservations enable row level security;`);
    const access=readFileSync(new URL("../../supabase/migrations/20261008010000_access_projection_integrity.sql",import.meta.url),"utf8");
    for(const statement of access.match(/create policy profile_stock_reservations_access_\w+[\s\S]*?;/g)??[])await db.exec(statement);
    if(candidate)await installOrderCancellationStockObjects(db);
    return db;
  }catch(error){await db.close();throw error;}
}

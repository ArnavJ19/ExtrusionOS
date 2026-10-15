import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHistoricalTables, historicalColumns, sqlDefinition } from "./lib/historical-schema-fixture.mjs";
import { installDirectOrderCandidateObjects } from "./lib/direct-order-fixture.mjs";
import { installDispatchReservationLedgerObjects } from "./lib/dispatch-reservation-ledger-fixture.mjs";
import { installOrderCancellationStockObjects } from "./lib/order-cancellation-stock-fixture.mjs";

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1),dealer=id(2),user=id(3),sales=id(4),sibling=id(5),otherDealer=id(6),quote=id(7),profile=id(8),batch=id(9),reservation=id(10),quoteLine=id(11);
const read=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");

export async function runDealerFulfillmentIntegrityChecks() {
  const db=new PGlite(),checks=[];
  const convert=async amount=>(await db.query("select public.fixture_convert_quote($1,$2) id",[quote,amount])).rows[0].id;
  const probe=async(fn,actor=user)=>{
    await db.exec(`reset role;begin;set test.actor='${actor}';set role authenticated;`);
    try {await fn();} finally {await db.exec("rollback;reset role;");}
  };
  try {
    await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      grant usage on schema public,auth,private to authenticated;`);
    const before="20261013000000_audit_workflow_followup.sql";
    await createHistoricalTables(db,[...historicalColumns(before).keys()],before);
    await db.exec(`create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_role() returns text language sql security definer as $$select role::text from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_dealer_id() returns uuid language sql security definer as $$select case when role::text like 'dealer_%' then case when id='${sibling}' then '${otherDealer}'::uuid else '${dealer}'::uuid end end from app_users where id=auth.uid() and is_active$$;
      insert into companies(id) values('${company}');
      insert into app_users(id,company_id,role,is_active,organization_type) values('${user}','${company}','dealer_staff',true,'dealer'),('${sales}','${company}','sales',true,'factory'),('${sibling}','${company}','dealer_admin',true,'dealer');
      insert into aluminium_profiles(id,company_id,profile_code) values('${profile}','${company}','P-1');
      insert into quotes(id,company_id,dealer_id,customer_id,status,grand_total,created_by) values('${quote}','${company}','${dealer}','${id(12)}','customer_approved',5900,'${user}');
      insert into quote_items(id,company_id,quote_id,profile_id,finishing_type,billing_weight_kg,total_weight_kg,net_rate,price_per_kg,line_total_before_gst) values('${quoteLine}','${company}','${quote}','${profile}','Mill Finish',50,50,100,100,5000);
      insert into profile_stock_batches(id,company_id,dealer_id,profile_id,finish,total_weight_kg,length_m,quantity_pieces,status) values('${batch}','${company}','${dealer}','${profile}','mill_finish',40,20,4,'reserved');
      insert into profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,initial_reserved_weight_kg,initial_reserved_length_m,initial_reserved_pieces) values('${reservation}','${company}','${batch}','${profile}',30,15,3,'active',30,15,3);
      insert into profile_stock_consumptions(id,company_id,reservation_id,consumed_weight_kg,consumed_length_m,consumed_pieces) values('${id(13)}','${company}','${reservation}',10,5,1);
      grant all on all tables in schema public to authenticated;`);
    for(const [file,names] of [
      ["20260715000000_atomic_business_workflows.sql",["private.insert_jsonb_row"]],
      ["20260930000000_astra_audit_fixes.sql",["private.next_business_number_locked"]],
      ["20260721091620_quote_atomic_dealer_lineage.sql",["private.enforce_dealer_fulfillment_lineage"]],
      ["20261008020000_factory_workflow_integrity.sql",["private.guard_reserved_stock_capacity","private.guard_production_order_balance"]]
    ]) for(const name of names) await db.exec(sqlDefinition(file,name));
    await db.exec(read("20261008010000_access_projection_integrity.sql"));
    await db.exec(read("20261013000000_audit_workflow_followup.sql"));
    const migration=read("20261013010000_dealer_fulfillment_integrity.sql");
    await db.exec(migration);await db.exec(migration);
    await installDirectOrderCandidateObjects(db);
    await installDispatchReservationLedgerObjects(db);
    await installOrderCancellationStockObjects(db);
    await db.exec(`create trigger enforce_dealer_fulfillment_lineage before insert or update on order_dealer_stock_fulfillments for each row execute function private.enforce_dealer_fulfillment_lineage();
      create trigger astra_reserved_stock before update on profile_stock_batches for each row execute function private.guard_reserved_stock_capacity();
      create trigger guard_production_order_balance before insert or update on production_jobs for each row execute function private.guard_production_order_balance();
      create function public.fixture_convert_quote(selected_quote uuid,weight_kg numeric) returns uuid language sql security definer set search_path=public,private as $$select private.create_order_from_quote_with_dealer_stock(selected_quote,null,current_date,null,'normal',weight_kg,'local audit acceptance')$$;
      revoke all on function public.fixture_convert_quote(uuid,numeric) from public,anon;
      grant execute on function public.fixture_convert_quote(uuid,numeric) to authenticated;`);

    for(const actor of [user,sales]) await probe(async()=>{
      const order=await convert(20);
      await db.exec("reset role;");
      const physical=(await db.query("select total_weight_kg,length_m,quantity_pieces,status from profile_stock_batches where id=$1",[batch])).rows[0];
      assert.deepEqual({...physical,total_weight_kg:Number(physical.total_weight_kg),length_m:Number(physical.length_m)},
        {total_weight_kg:20,length_m:10,quantity_pieces:2,status:"reserved"});
      const header=(await db.query("select dealer_fulfilled_weight_kg,manufacturing_weight_kg,order_value from orders where id=$1",[order])).rows[0];
      assert.deepEqual(Object.fromEntries(Object.entries(header).map(([key,value])=>[key,Number(value)])),{dealer_fulfilled_weight_kg:20,manufacturing_weight_kg:30,order_value:5900});
      const line=(await db.query("select quantity_kg,dealer_fulfilled_weight_kg,manufacturing_weight_kg,quote_item_id,source_line_id from order_items where order_id=$1",[order])).rows[0];
      assert.deepEqual({...line,quantity_kg:Number(line.quantity_kg),dealer_fulfilled_weight_kg:Number(line.dealer_fulfilled_weight_kg),manufacturing_weight_kg:Number(line.manufacturing_weight_kg)},
        {quantity_kg:50,dealer_fulfilled_weight_kg:20,manufacturing_weight_kg:30,quote_item_id:quoteLine,source_line_id:quoteLine});
      const debit=(await db.query("select fulfilled_weight_kg,fulfilled_length_m,fulfilled_pieces from order_dealer_stock_fulfillments where order_id=$1",[order])).rows[0];
      assert.deepEqual({...debit,fulfilled_weight_kg:Number(debit.fulfilled_weight_kg),fulfilled_length_m:Number(debit.fulfilled_length_m)},
        {fulfilled_weight_kg:20,fulfilled_length_m:10,fulfilled_pieces:2});
      const lineId=(await db.query("select id from order_items where order_id=$1",[order])).rows[0].id;
      await db.query("insert into production_jobs(company_id,order_id,profile_id,source_line_id,planned_quantity_kg,status) values($1,$2,$3,$4,30,'planned')",[company,order,profile,lineId]);
      await db.exec("savepoint remaining_quantity;");
      await assert.rejects(db.query("insert into production_jobs(company_id,order_id,profile_id,source_line_id,planned_quantity_kg,status) values($1,$2,$3,$4,1,'planned')",[company,order,profile,lineId]),/exceeds the order line remaining/);
      await db.exec("rollback to remaining_quantity;release remaining_quantity;");
      assert.equal((await db.query("select count(*)::int n from private.quote_fulfillment_authorizations")).rows[0].n,0);
      await db.exec("set role authenticated;");
      if(actor===sales) {
        await assert.rejects(db.query("update order_items set manufacturing_weight_kg=999 where order_id=$1 returning id",[order]),/authorized order workflow/);
      } else {
        const blindEdit=await db.query("update order_items set manufacturing_weight_kg=999 where order_id=$1 returning id",[order]);
        assert.equal(blindEdit.rows.length,0,"RLS must prevent dealer blind line edits after conversion");
      }
    },actor);
    checks.push("dealer and sales conversions reconcile protected order lines and exact remaining physical stock");

    for(const amount of [10.5,30]) await probe(async()=>{
      await assert.rejects(convert(amount),/whole pieces|unreserved dealer stock/);
    });
    assert.equal((await db.query("select count(*)::int n from orders")).rows[0].n,0);
    assert.equal(Number((await db.query("select total_weight_kg from profile_stock_batches where id=$1",[batch])).rows[0].total_weight_kg),40);
    checks.push("fractional pieces and held-stock over-allocation roll back header, lines and stock");

    await probe(async()=>{
      await db.exec("reset role;set test.actor='';");await db.query("update quotes set created_by=$1 where id=$2",[sibling,quote]);
      await db.exec(`set test.actor='${sibling}';set role authenticated;`);
      await assert.rejects(convert(0),/only convert their own quotations/);
    },sibling);
    checks.push("a sibling dealer cannot convert another dealership's quote even when named as its creator");

    await probe(async()=>{
      await db.exec("reset role;");await db.query("update app_users set is_active=false where id=$1",[user]);await db.exec("set role authenticated;");
      await assert.rejects(convert(0),/Authentication required/);
    });
    const privileges=(await db.query("select has_table_privilege('authenticated','private.quote_fulfillment_authorizations','INSERT') allowed")).rows[0];
    assert.equal(privileges.allowed,false);
    checks.push("suspended identities and forged private fulfillment authorizations fail closed");

    await probe(async()=>{
      const order=await convert(20);
      await db.exec("reset role;");
      const before={stock:(await db.query("select * from profile_stock_batches where id=$1",[batch])).rows,
        fulfillment:(await db.query("select * from order_dealer_stock_fulfillments where order_id=$1",[order])).rows,
        movements:(await db.query("select * from inventory_transactions where order_id=$1",[order])).rows};
      await db.query("update app_users set role='owner' where id=$1",[user]);await db.exec("set role authenticated;");
      await db.query("update orders set current_stage='cancelled' where id=$1",[order]);await db.exec("reset role;");
      assert.deepEqual((await db.query("select * from profile_stock_batches where id=$1",[batch])).rows,before.stock);
      assert.deepEqual((await db.query("select * from order_dealer_stock_fulfillments where order_id=$1",[order])).rows,before.fulfillment);
      assert.deepEqual((await db.query("select * from inventory_transactions where order_id=$1",[order])).rows,before.movements);
      assert.equal((await db.query("select count(*)::int n from audit_logs where entity_id=$1 and action='order_cancelled_hold_release'",[order])).rows[0].n,1);
    });
    checks.push("cancellation after actual quote conversion preserves dealer physical debits and immutable commercial lineage");
    return checks;
  } finally {await db.close();}
}

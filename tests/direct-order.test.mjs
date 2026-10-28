import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDirectOrderFixture, installDirectOrderCandidateObjects, fixtureId as id, directOrderCandidate } from "../scripts/lib/direct-order-fixture.mjs";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";
import { calculateDirectOrderLine, canCreateDirectOrder, directOrderSchema } from "../lib/orders/direct-order.ts";
import { buildProductionJobPcdaFields, chooseProductionSourceLine } from "../lib/pcda/production.ts";
import { buildVerifiedPackingListItems } from "../lib/pcda/dispatch.ts";
import { buildInvoiceItems } from "../lib/pcda/invoice.ts";

let db;
const company=id(1),actor=id(3),customer=id(10),profile=id(20),key=id(100);
const line = extra => ({profile_id:profile,die_id:null,quantity_pieces:10,length_per_piece_m:6,expected_section_weight_kg_per_m:.5,net_rate:250,gst_percent:18,hsn_code:"760421",finishing_type:"mill_finish",...extra});
const header = extra => ({customer_id:customer,order_date:"2026-10-15",expected_dispatch_date:null,priority:"normal",notes:"Direct priced order",...extra});
async function attempt(callback) {
  await db.exec("savepoint direct_attempt;");
  try {const result=await callback();await db.exec("release savepoint direct_attempt;");return result;}
  catch(error){await db.exec("rollback to savepoint direct_attempt;release savepoint direct_attempt;");throw error;}
}
async function observe(callback) {
  await db.exec("reset role;");
  try{return await attempt(callback);}finally{await db.exec("set role authenticated;");}
}
const create = (items=[line()],order=header(),requestKey=key) => attempt(async()=>
  (await db.query("select public.create_direct_order_atomic($1,$2,$3) id",[order,items,requestKey])).rows[0].id);
const rows = sql => observe(async()=>(await db.query(sql)).rows);
const edit = (sql,params=[]) => observe(()=>db.query(sql,params));
async function counts(){return rows(`select (select count(*) from orders) orders,(select count(*) from order_items) lines,
  (select count(*) from private.direct_order_requests) requests,(select count(*) from audit_logs) audits,(select count(*) from order_stage_history) history`);}

test.before(async()=>{
  db=await createDirectOrderFixture({candidate:false});
  await db.exec(`begin;set test.actor='${actor}';update app_users set role='owner' where id='${actor}';`);
  const legacy=(await db.query("select private.save_order_atomic(null,$1) id",[{...header(),order_value:8850,items:[line()]}])).rows[0].id;
  assert.deepEqual((await db.query("select order_value,(select count(*) from order_items where order_id=orders.id) lines from orders where id=$1",[legacy])).rows[0],{order_value:"0.00",lines:0});
  await db.exec("rollback;");
  await installDirectOrderCandidateObjects(db);
});
test.after(async()=>{if(db)await db.close();});
test.beforeEach(async()=>{await db.exec(`begin;set test.actor='${actor}';set role authenticated;`);});
test.afterEach(async()=>{await db.exec("rollback;reset role;");});

test("direct creation saves priced commercial lines with derived totals and separate exact identities",async()=>{
  const order=await create([line({die_id:id(30)}),line({quantity_pieces:5,net_rate:300,gst_percent:0,finishing_type:"anodizing"})]);
  const saved=(await rows(`select * from orders where id='${order}'`))[0];
  assert.equal(saved.quote_id,null);assert.equal(saved.dealer_id,null);assert.equal(saved.order_origin,"FACTORY_DIRECT");
  assert.equal(saved.order_value,"13350.00");assert.equal(saved.requested_weight_kg,"45.000");assert.equal(saved.manufacturing_weight_kg,"45.000");
  const items=await rows(`select * from order_items where order_id='${order}' order by quantity_pieces desc`);
  assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);
  assert.equal(items[0].final_line_value,"7500.00");assert.equal(items[0].quantity_kg,"30.000");assert.equal(items[1].final_line_value,"4500.00");
  assert.ok(items.every(item=>item.quote_item_id===null&&item.source_line_id===null&&item.company_id===company));
  assert.equal((await rows(`select * from factory_load_consolidations where order_id='${order}'`))[0].status,"pending");
  assert.deepEqual(await counts(),[{orders:1,lines:2,requests:1,audits:1,history:1}]);
});

test("the old header save rejects new unpriced direct orders while preserving operational edits of a priced order",async()=>{
  for(const role of ["sales","owner","production_manager"]){
    await edit("update app_users set role=$1 where id=$2",[role,actor]);
    await assert.rejects(edit("select private.save_order_atomic(null,$1)",[{...header(),order_value:8850,items:[line()]}]),/direct priced order entry/);
  }
  await edit("update app_users set role='owner' where id=$1",[actor]);const order=await create();
  await edit("select private.save_order_atomic($1,$2)",[order,{...header({notes:"Operational delivery note",priority:"high"}),current_stage:"order_confirmed"}]);
  const saved=(await rows(`select notes,priority,order_value from orders where id='${order}'`))[0];
  assert.deepEqual(saved,{notes:"Operational delivery note",priority:"high",order_value:"8850.00"});
  assert.equal((await counts())[0].orders,1);assert.equal((await counts())[0].lines,1);
});

test("both repeated and different profiles produce complete grouped billet requirements that survive rebuilding",async()=>{
  const order=await create([line(),line({finishing_type:"anodizing"}),line({profile_id:id(21),expected_section_weight_kg_per_m:1.125,quantity_pieces:20})]);
  const get=()=>rows(`select profile_id,alloy,temper,billet_diameter_inch,required_weight_kg,billets_required from order_billet_requirements where order_id='${order}' order by profile_id`);
  const original=await get();assert.equal(original.length,2);assert.equal(original[0].required_weight_kg,"60.000");assert.equal(original[1].required_weight_kg,"135.000");
  assert.ok(original.every(requirement=>requirement.billets_required>0));
  await edit("select public.rebuild_order_billet_requirements($1)",[order]);assert.deepEqual(await get(),original);
  await edit("update app_users set role='factory_manager' where id=$1",[actor]);
  await edit("update orders set priority='high' where id=$1",[order]);assert.deepEqual(await get(),original);
  const queue=(await rows(`select * from factory_load_consolidations where order_id='${order}'`))[0];
  assert.match(queue.compatibility_signature,/6061/);assert.match(queue.compatibility_signature,/6063/);
  await edit("update aluminium_profiles set alloy='6082',temper='T5',billet_diameter_required_inch=10,section_weight_kg_per_m=9 where company_id=$1",[company]);
  await edit("select public.rebuild_order_billet_requirements($1)",[order]);assert.deepEqual(await get(),original);
});

test("cancelling a direct order cancels its material requirements without fabricating a physical return",async()=>{
  const order=await create();await edit("update app_users set role='owner' where id=$1",[actor]);
  await edit("update orders set current_stage='cancelled' where id=$1",[order]);
  assert.ok((await rows(`select status from order_billet_requirements where order_id='${order}'`)).every(row=>row.status==="cancelled"));
  assert.equal((await rows(`select billet_allocation_status from orders where id='${order}'`))[0].billet_allocation_status,"not_required");
  assert.equal((await counts())[0].lines,1);assert.equal(await create(),order);
});

test("factory queue boundary is exact at 700 kg and no direct entry consumes dealer or finished stock",async()=>{
  const below=await create([line({quantity_pieces:2,length_per_piece_m:699.999})],header(),id(101));
  assert.equal((await rows(`select manufacturing_weight_kg from orders where id='${below}'`))[0].manufacturing_weight_kg,"699.999");
  assert.equal((await rows(`select count(*) count from factory_load_consolidations where order_id='${below}'`))[0].count,1);
  const threshold=await create([line({quantity_pieces:1400,length_per_piece_m:1})],header(),id(102));
  assert.equal((await rows(`select count(*) count from factory_load_consolidations where order_id='${threshold}'`))[0].count,0);
  assert.equal((await rows("select count(*) count from order_dealer_stock_fulfillments"))[0].count,0);
});

test("one retry key returns the original record while changed order or line details reject without posting",async()=>{
  const order=await create();const before=await counts();
  assert.equal(await create([line({hsn_code:" 760421 "})],header({notes:"  Direct priced order  "})),order);
  for(const [items,orderInput] of [[ [line({net_rate:251})],header() ],[[line()],header({notes:"Other agreement"})],[[line()],header({customer_id:id(11)})],[[line({quantity_pieces:11})],header()]]){
    await assert.rejects(create(items,orderInput),/retry key already belongs/);
  }
  await edit("update aluminium_profiles set is_active=false,section_weight_kg_per_m=9 where id=$1",[profile]);
  assert.equal(await create(),order);assert.deepEqual(await counts(),before);
  await assert.rejects(create([line()],header(),id(103)),/active profile/);
});

test("a stale profile preview or forged section weight cannot silently alter the accepted order value",async()=>{
  await edit("update aluminium_profiles set section_weight_kg_per_m=.6 where id=$1",[profile]);
  await assert.rejects(create(),/section weight changed/);assert.equal((await counts())[0].orders,0);
  await assert.rejects(create([line({expected_section_weight_kg_per_m:.1})]),/section weight changed/);
  const order=await create([line({expected_section_weight_kg_per_m:.6})]);
  assert.equal((await rows(`select order_value from orders where id='${order}'`))[0].order_value,"10620.00");
});

test("a rejected later line or final audit rolls back header, lines, request, history and numbering together",async()=>{
  await assert.rejects(create([line(),line({profile_id:id(22)})]),/active profile/);assert.equal((await counts())[0].orders,0);
  await observe(()=>db.exec(`create function public.fixture_audit_failure() returns trigger language plpgsql as $$begin raise exception 'fixture final audit failure';end;$$;
    create trigger fixture_audit_failure before insert on audit_logs for each row execute function public.fixture_audit_failure();`));
  await assert.rejects(create(),/fixture final audit failure/);assert.deepEqual(await counts(),[{orders:0,lines:0,requests:0,audits:0,history:0}]);
  await edit("drop trigger fixture_audit_failure on audit_logs;");
  const order=await create();assert.equal((await rows(`select order_number from orders where id='${order}'`))[0].order_number,"O-2026-0001");
});

test("only internal commercial roles may create direct priced orders, including on exact retries",async()=>{
  for(const role of ["owner","admin","sales_manager","sales"]){await edit("update app_users set role=$1 where id=$2",[role,actor]);await create([line()],header(),id(110+["owner","admin","sales_manager","sales"].indexOf(role)));}
  for(const role of ["factory_manager","production_manager","production","inventory_manager","dispatch_manager","dispatch","accounts","quality","viewer","dealer_admin","dealer_staff","unknown",null]){
    await edit("update app_users set role=$1 where id=$2",[role,actor]);await assert.rejects(create([line()],header(),id(110)),/internal owner, admin or sales role/);
  }
  await edit("update app_users set role='sales',is_active=false where id=$1",[actor]);await assert.rejects(create(),/Authentication required/);
  await edit("update app_users set is_active=true,dealer_id=$1 where id=$2",[id(900),actor]);await assert.rejects(create(),/internal owner, admin or sales role/);
  await edit("select set_config('test.actor','',true)");await assert.rejects(create(),/Authentication required/);
});

test("company is derived from active identity and foreign customers, profiles and dies cannot enter the order",async()=>{
  await assert.rejects(create([line()],header({customer_id:id(11)})),/Customer not found/);
  await assert.rejects(create([line({profile_id:id(22)})]),/active profile/);
  await assert.rejects(create([line({die_id:id(31)})]),/compatible die/);
  await assert.rejects(create([line({profile_id:id(21),expected_section_weight_kg_per_m:1.125,die_id:id(30)})]),/compatible die/);
  const first=await create();
  await edit("select set_config('test.actor',$1,true)",[id(4)]);
  const second=await create([line({profile_id:id(22)})],header({customer_id:id(11)}));
  assert.notEqual(first,second);assert.equal((await rows(`select company_id from orders where id='${second}'`))[0].company_id,id(2));
  assert.equal((await counts())[0].orders,2);
});

test("malformed, excessive, zero, nonfinite or forged commercial inputs fail before posting",async()=>{
  for(const items of [[],Array.from({length:101},()=>line()),null,{},[line({net_rate:0})],[line({quantity_pieces:1.5})],
    [line({length_per_piece_m:0.0001})],[line({net_rate:1.001})],[line({gst_percent:101})],[line({gst_percent:-1})],
    [line({hsn_code:"76042"})],[line({net_rate:"NaN"})],[line({net_rate:"Infinity"})],[line({net_rate:true})],
    [line({company_id:id(2)})],[line({final_line_value:1})],[line({finishing_type:"invented"})]]) await assert.rejects(create(items));
  await assert.rejects(create([line({quantity_pieces:1000001})]));
  await assert.rejects(create([line({net_rate:10000000.01})]));
  await assert.rejects(create([line({quantity_pieces:1000000,length_per_piece_m:1000})]),/too small or too large/);
  await assert.rejects(create([line({quantity_pieces:1000000,length_per_piece_m:1,net_rate:1000000}),line({quantity_pieces:1000000,length_per_piece_m:1,net_rate:1000000})]),/combined order exceeds/);
  for(const order of [header({company_id:id(2)}),header({order_value:1}),header({quote_id:id(50)}),header({order_date:"2026-02-31"}),header({expected_dispatch_date:"2026-10-14"})]) await assert.rejects(create([line()],order));
  await assert.rejects(create([line()],header(),null),/retry key/);
  assert.deepEqual(await counts(),[{orders:0,lines:0,requests:0,audits:0,history:0}]);
});

test("missing or invalid material provenance and inactive or mismatched dies cannot be accepted",async()=>{
  for(const [table,record,message] of [["customers",customer,/Customer not found/],["aluminium_profiles",profile,/active profile/],["dies",id(30),/compatible die/]]){
    await edit(`update ${table} set deleted_at=now() where id=$1`,[record]);
    await assert.rejects(create([line({die_id:id(30)})]),message);
    await edit(`update ${table} set deleted_at=null where id=$1`,[record]);
  }
  for(const [field,value] of [["section_weight_kg_per_m",0],["alloy",""],["temper",null],["billet_diameter_required_inch",null]]){
    await edit(`update aluminium_profiles set ${field}=$1 where id=$2`,[value,profile]);
    await assert.rejects(create(),/Complete the profile/);
    await edit("update aluminium_profiles set section_weight_kg_per_m=.5,alloy='6063',temper='T6',billet_diameter_required_inch=6 where id=$1",[profile]);
  }
  for(const status of ["under_maintenance","inactive",null]){
    await edit("update dies set die_status=$1 where id=$2",[status,id(30)]);await assert.rejects(create([line({die_id:id(30)})]),/compatible die/);
  }
  await edit("update dies set die_status='active',billet_diameter_required_inch=8 where id=$1",[id(30)]);await assert.rejects(create([line({die_id:id(30)})]),/compatible die/);
});

test("created direct line snapshots and commercial header identity cannot be changed even with broad table grants",async()=>{
  const order=await create();const item=(await rows(`select id from order_items where order_id='${order}'`))[0].id;
  for(const role of ["sales","owner","admin"]){
    await edit("update app_users set role=$1 where id=$2",[role,actor]);
    for(const sql of [`update order_items set net_rate=1 where id='${item}'`,`delete from order_items where id='${item}'`,
      `insert into order_items(company_id,order_id,profile_id,quantity_kg,net_rate) values('${company}','${order}','${profile}',1,1)`,
      `update orders set customer_id='${id(11)}' where id='${order}'`,`update orders set company_id='${id(2)}' where id='${order}'`,
      `delete from orders where id='${order}'`]) await assert.rejects(attempt(()=>db.exec(sql)),/immutable|authorized order workflow|Only owners/);
    await assert.rejects(edit(`update order_items set final_line_value=1 where id='${item}'`),/immutable|authorized order workflow/);
  }
  assert.equal((await rows(`select order_value from orders where id='${order}'`))[0].order_value,"8850.00");
});

test("exact line identity controls production commitment when one profile has two prices or finishes",async()=>{
  const order=await create([line(),line({net_rate:300,finishing_type:"anodizing"})]);
  const lines=await rows(`select * from order_items where order_id='${order}' order by net_rate`);
  assert.equal(chooseProductionSourceLine(lines,profile),null);assert.equal(chooseProductionSourceLine(lines,profile,lines[1].id).net_rate,"300.00");
  await edit("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg) values($1,$2,$3,$4,$5,'planned',20)",[id(40),company,order,profile,lines[0].id]);
  await assert.rejects(edit("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg) values($1,$2,$3,$4,$5,'planned',11)",[id(41),company,order,profile,lines[0].id]),/exceeds/);
  await assert.rejects(edit("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg) values($1,$2,$3,$4,'planned',1)",[id(41),company,order,profile]),/exact order line/);
  await edit("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg) values($1,$2,$3,$4,$5,'planned',30)",[id(41),company,order,profile,lines[1].id]);
});

test("production, packing and invoice builders and canonicalizers retain direct rates, GST, HSN and partial shipment values",async()=>{
  const order=await create([line({net_rate:250}),line({net_rate:300,gst_percent:5,hsn_code:"760429",finishing_type:"anodizing"})]);
  const lines=await rows(`select * from order_items where order_id='${order}' order by net_rate`);
  await edit("insert into dispatches(id,company_id,order_id) values($1,$2,$3)",[id(60),company,order]);
  const packed=[];
  for(const [index,saved] of lines.entries()){
    const production={...buildProductionJobPcdaFields(saved,company),id:id(70+index),order_id:order,profile_id:profile,
      actual_quantity_kg:15,actual_meters:30,actual_pieces:5,source_kind:"production",net_rate:Number(saved.net_rate)};
    await edit("select private.insert_jsonb_row('production_jobs'::regclass,$1)",[{...production,status:"completed",planned_quantity_kg:15}]);
    const manifest=buildVerifiedPackingListItems([production],company,[{source_line_id:production.id,bundle_number:`DIRECT-${index}`,gross_weight_kg:16,tare_weight_kg:1,number_of_pieces:5,net_length_m:30}]);
    const packingId=(await observe(()=>db.query("select private.insert_jsonb_row('packing_list_items'::regclass,$1) id",[{...manifest.items[0],dispatch_id:id(60),gst_percent:0}]))).rows[0].id;
    const packing=(await rows(`select * from packing_list_items where id='${packingId}'`))[0];
    assert.equal(packing.order_item_id,saved.id);assert.equal(packing.quote_item_id,null);assert.equal(packing.net_rate,saved.net_rate);packed.push(packing);
  }
  await edit("insert into invoices(id,company_id,dispatch_id) values($1,$2,$3)",[id(80),company,id(60)]);
  const invoiceItems=buildInvoiceItems(packed,id(80),company);
  assert.deepEqual(invoiceItems.map(item=>item.line_total),[3750,4500]);
  for(const item of invoiceItems) await edit("select private.insert_jsonb_row('invoice_items'::regclass,$1)",[item]);
  const invoiced=await rows(`select order_item_id,quote_item_id,net_rate,gst_percent,hsn_code,line_total from invoice_items order by net_rate`);
  assert.equal(invoiced[0].gst_percent,"18.00");assert.equal(invoiced[1].gst_percent,"5.00");assert.equal(invoiced[1].hsn_code,"760429");
  assert.equal(invoiced[1].order_item_id,lines[1].id);assert.equal(invoiced[1].quote_item_id,null);
});

test("unmanaged historical sources retain their previous packing-first invoice tax precedence",async()=>{
  await edit("update app_users set role='owner' where id=$1",[actor]);
  await edit("insert into orders(id,company_id,customer_id,order_number) values($1,$2,$3,'HISTORICAL-DIRECT')",[id(201),company,customer]);
  await edit("insert into order_items(id,company_id,order_id,profile_id,quantity_kg,net_rate,gst_percent,hsn_code,final_line_value) values($1,$2,$3,$4,30,250,18,'760421',7500)",[id(202),company,id(201),profile]);
  await edit("insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,status,actual_quantity_kg,planned_quantity_kg) values($1,$2,$3,$4,$5,'completed',10,10)",[id(203),company,id(201),id(202),profile]);
  await edit("insert into dispatches(id,company_id,order_id) values($1,$2,$3)",[id(204),company,id(201)]);
  await edit("insert into packing_list_items(id,company_id,dispatch_id,source_record_id,source_line_id,source_kind,profile_id,gst_percent) values($1,$2,$3,$4,$5,'production',$6,5)",[id(206),company,id(204),id(201),id(203),profile]);
  await edit("insert into invoices(id,company_id,dispatch_id) values($1,$2,$3)",[id(205),company,id(204)]);
  await edit("insert into invoice_items(company_id,invoice_id,source_line_id,quantity,unit_rate,line_total) values($1,$2,$3,10,250,2500)",[company,id(205),id(206)]);
  assert.equal((await rows(`select gst_percent from invoice_items where invoice_id='${id(205)}'`))[0].gst_percent,"5.00");
});

test("positive decimal rounding matches PostgreSQL for 100 varied priced lines, including half-paise boundaries",async()=>{
  const items=Array.from({length:100},(_,index)=>line({quantity_pieces:index+1,length_per_piece_m:(index+1)/1000,
    net_rate:(12501+index)/100,gst_percent:index%2?5:18}));
  const expected=items.map(item=>calculateDirectOrderLine(item,.5));
  const order=await create(items);
  const saved=await rows(`select quantity_pieces,quantity_kg,final_line_value from order_items where order_id='${order}' order by quantity_pieces`);
  assert.equal(saved.length,100);
  for(let index=0;index<100;index++){assert.equal(Number(saved[index].quantity_kg),expected[index].quantity_kg);assert.equal(Number(saved[index].final_line_value),expected[index].subtotal);}
  const total=expected.reduce((sum,item)=>sum+Math.round(item.grand_total*100),0)/100;
  assert.equal(Number((await rows(`select order_value from orders where id='${order}'`))[0].order_value),total);
});

test("anonymous execute, private implementations, request reads and material rebuild remain closed",async()=>{
  const acl=(await rows(`select has_function_privilege('anon','public.create_direct_order_atomic(jsonb,jsonb,uuid)','EXECUTE') anonymous,
    has_function_privilege('authenticated','private.create_direct_order_atomic(jsonb,jsonb,uuid)','EXECUTE') private_create,
    has_function_privilege('authenticated','public.rebuild_order_billet_requirements(uuid)','EXECUTE') material_rebuild,
    has_table_privilege('authenticated','private.direct_order_requests','SELECT') request_read,
    has_table_privilege('authenticated','private.direct_order_requests','INSERT') request_write`))[0];
  assert.deepEqual(acl,{anonymous:false,private_create:false,material_rebuild:false,request_read:false,request_write:false});
  await assert.rejects(attempt(()=>db.query("select private.create_direct_order_atomic($1,$2,$3)",[header(),[line()],key])),/permission denied/);
  const preflight=readFileSync(new URL("../sql/audit-deployment-preflight.sql",import.meta.url),"utf8")
    .split("-- Direct order request contents are private; verify their ACL and snapshot guards.")[1]
    .split("-- Credit settlement guards are private triggers")[0];
  const catalog=await observe(()=>db.query(preflight));assert.equal(catalog.rows.length,2);
  assert.ok(catalog.rows.every(row=>row.attached&&row.enabled&&row.request_rls&&!row.authenticated_execute&&!row.anonymous_execute&&!row.request_read&&!row.request_write));
});

test("historical commercial review is read-only and flags missing or invalid direct lines without inventing prices",async()=>{
  const valid=await create();
  await edit("update app_users set role='owner' where id=$1",[actor]);
  await edit("insert into orders(id,company_id,customer_id,order_number,quote_id) values($1,$2,$3,'LEGACY-MISSING',null)",[id(200),company,customer]);
  await edit("insert into orders(id,company_id,customer_id,order_number,quote_id) values($1,$2,$3,'LEGACY-INVALID',null)",[id(201),company,customer]);
  await edit("insert into order_items(company_id,order_id,profile_id,quantity_kg,net_rate,gst_percent,hsn_code,final_line_value) values($1,$2,$3,1,0,18,'760421',100)",[company,id(201),profile]);
  const before=await counts();
  const reviewed=await observe(async()=>{
    await db.exec("create role direct_order_audit_reader;grant usage on schema public to direct_order_audit_reader;grant select on orders,order_items to direct_order_audit_reader;set role direct_order_audit_reader;");
    return (await db.query(readFileSync(new URL("../sql/audit-direct-order-lines.sql",import.meta.url),"utf8"))).rows;
  });
  assert.equal(reviewed.length,2);assert.equal(reviewed.find(row=>row.id===id(200)).missing_commercial_lines,true);
  assert.equal(reviewed.find(row=>row.id===id(201)).invalid_commercial_lines,true);assert.ok(reviewed.every(row=>row.id!==valid));
  assert.deepEqual(await counts(),before);
});

test("the legacy quoted and header-only billet rebuild body is preserved after the direct dispatch branch",()=>{
  const original=sqlDefinition("20260515005600_order_billet_requirements_and_allocation.sql","public.rebuild_order_billet_requirements");
  const candidate=sqlDefinition(directOrderCandidate,"public.rebuild_order_billet_requirements");
  const marker="  select * into v_order from public.orders where id = p_order_id;";
  assert.equal(candidate.slice(candidate.indexOf(marker)),original.slice(original.indexOf(marker)));
});

test("input validation and UI permission cohort agree on deliberate commercial entry",()=>{
  const input={idempotency_key:key,order:header(),items:[line()]};
  assert.equal(directOrderSchema.safeParse(input).success,true);
  for(const role of ["owner","admin","sales_manager","sales"]) assert.equal(canCreateDirectOrder(role),true);
  for(const role of ["production_manager","factory_manager","accounts","dealer_admin","dealer_staff","viewer"]) assert.equal(canCreateDirectOrder(role),false);
  assert.equal(canCreateDirectOrder("owner",id(900)),false);
  for(const field of ["company_id","order_value","quote_id"]) assert.equal(directOrderSchema.safeParse({...input,order:{...input.order,[field]:id(2)}}).success,false);
  for(const bad of [NaN,Infinity,-1,true,"100"]) assert.equal(directOrderSchema.safeParse({...input,items:[line({net_rate:bad})]}).success,false);
  assert.equal(directOrderSchema.safeParse({...input,order:header({order_date:"2026-02-31"})}).success,false);
  assert.throws(()=>calculateDirectOrderLine(line({length_per_piece_m:.001,expected_section_weight_kg_per_m:.001,net_rate:.01,quantity_pieces:1}),.001),/too small/);
  assert.match(readFileSync(new URL("../app/(dashboard)/orders/new/page.tsx",import.meta.url),"utf8"),/From approved quotation/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createHistoricalTables, historicalColumns, sqlDefinition } from "./lib/historical-schema-fixture.mjs";

const migrationName = "20261008030000_configuration_quote_integrity.sql";
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1), other=id(2), owner=id(3), sales=id(4), production=id(5), suspended=id(6), customer=id(7), config=id(8);
const profiles=[id(10),id(11),id(12)], dies=[id(20),id(21),id(22)];
const db=new PGlite();
try {
  await db.exec(`create schema private; create schema auth; create role authenticated; create role anon;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated;
    set test.actor='${owner}';`);
  const coreTables=["app_users","companies","company_settings","customers","aluminium_profiles","quotes","quote_items","orders","order_items","system_configurations","system_profile_cuts","system_beading_cuts","system_series","system_profiles","profile_optimization_runs","audit_logs","production_jobs","production_plan_slots","order_stage_history","dies","machines","order_dealer_stock_fulfillments"];
  const access=read("20261008010000_access_projection_integrity.sql");
  const available=historicalColumns(migrationName);
  const tables=[...new Set([...coreTables,...[...access.matchAll(/public\.(\w+)/g)].map(match=>match[1]).filter(name=>available.has(name))])];
  await createHistoricalTables(db,tables,migrationName);
  await db.exec(`create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer as $$select role::text from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql as $$select null::uuid$$;
    insert into app_users(id,company_id,role,is_active) values('${owner}','${company}','owner',true),('${sales}','${company}','sales',true),('${production}','${company}','production_manager',true),('${suspended}','${company}','owner',false);
    insert into companies(id) values('${company}'),('${other}');
    insert into customers(id,company_id,customer_name) values('${customer}','${company}','Synthetic buyer');
    insert into company_settings(id,company_id,default_quote_validity_days,minimum_margin_percent) values('${company}','${company}',15,5);
    insert into system_configurations(id,company_id,customer_id,status,configuration_number,project_name,quantity,subtotal,internal_cost,gst_percent,gst_amount,grand_total) values('${config}','${company}','${customer}','calculated','SC-QUOTE-TEST','Mixed profile acceptance',1,100.01,80.02,18,18,118.01);
    insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,is_active,hsn_code) values('${profiles[0]}','${company}','A','Repeated cuts',2,true,'7604'),('${profiles[1]}','${company}','B','Second profile',1.333,true,'7604'),('${profiles[2]}','${company}','C','Beading profile',0.555,true,'7604');
    insert into dies(id,company_id,profile_id,die_status) values('${dies[0]}','${company}','${profiles[0]}','available'),('${dies[1]}','${company}','${profiles[1]}','available'),('${dies[2]}','${company}','${profiles[2]}','available');
    insert into system_profile_cuts(id,company_id,configuration_id,profile_id,quantity,cut_length_mm,total_length_m,total_weight_kg) values('${id(30)}','${company}','${config}','${profiles[0]}',2,3000,6,12),('${id(31)}','${company}','${config}','${profiles[0]}',1,5000,5,10),('${id(32)}','${company}','${config}','${profiles[1]}',3,2201,6.603,8.802);
    insert into system_beading_cuts(id,company_id,configuration_id,profile_id,quantity,cut_length_mm,total_length_m) values('${id(33)}','${company}','${config}','${profiles[2]}',5,1101,5.505);`);
  for(const [file,names] of [
    ["20260715000000_atomic_business_workflows.sql",["private.insert_jsonb_row","private.keep_jsonb_keys"]],
    ["20260929000000_business_logic_fixes.sql",["public.recalculate_quote_item_financials","private.derive_quote_header_financials","private.convert_quote_to_order_atomic","public.derive_order_value_from_quote"]],
    ["20260715000000_atomic_business_workflows.sql",["public.convert_quote_to_order_atomic"]],
    ["20260812000000_security_and_notification_integrity.sql",["private.refresh_quote_header_after_item_change"]],
    ["20260930000000_astra_audit_fixes.sql",["private.next_business_number_locked","private.handoff_system_configuration_to_production_atomic"]],
    ["20260723030000_atomic_system_production_handoff.sql",["public.handoff_system_configuration_to_production_atomic"]],
    ["20261008020000_factory_workflow_integrity.sql",["private.guard_production_order_balance","private.validate_production_start_resources"]]
  ]) for(const name of names) await db.exec(sqlDefinition(file,name));
  await db.exec("grant all on all tables in schema public to authenticated;");
  await db.exec(access);await db.exec(access);
  await db.exec(`create trigger recalculate_quote_item_financials before insert or update on quote_items for each row execute function public.recalculate_quote_item_financials();
    create trigger derive_quote_header_financials before insert or update on quotes for each row execute function private.derive_quote_header_financials();
    create trigger refresh_quote_header_after_item_change after insert or update or delete on quote_items for each row execute function private.refresh_quote_header_after_item_change();
    create trigger derive_order_value_from_quote before insert or update on orders for each row execute function public.derive_order_value_from_quote();
    create trigger guard_production_order_balance before insert or update on production_jobs for each row execute function private.guard_production_order_balance();
    create trigger validate_production_start_resources before insert or update on production_jobs for each row execute function private.validate_production_start_resources();
    revoke all on function private.convert_quote_to_order_atomic(uuid,jsonb),private.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) from public,anon,authenticated;
    grant execute on function public.convert_quote_to_order_atomic(uuid,jsonb),public.handoff_system_configuration_to_production_atomic(uuid,jsonb,text) to authenticated;`);
  const migration=read(migrationName);
  await db.exec(migration); await db.exec(migration);
  const generate=async(configuration=config)=>(await db.query("select public.generate_system_quote_atomic($1) as id",[configuration])).rows[0].id;
  await db.exec("set role authenticated;");
  const quoteId=await generate();
  assert.equal(await generate(),quoteId);
  await db.exec("reset role;");
  const lines=(await db.query("select * from quote_items where quote_id=$1 order by profile_id",[quoteId])).rows;
  assert.equal(lines.length,3);
  assert.deepEqual(lines.map(row=>[row.profile_id,Number(row.quantity_pieces),Number(row.total_meters),Number(row.total_weight_kg)]),[[profiles[0],3,11,22],[profiles[1],3,6.603,8.802],[profiles[2],5,5.505,3.055]]);
  assert.equal(lines[0].configuration_cut_snapshot.length,2);
  assert.equal(lines[2].configuration_cut_snapshot[0].kind,"beading");
  assert.ok(Math.abs(Number(lines[0].length_per_piece_m)-11/3)<1e-10);
  assert.equal(Number(lines.reduce((sum,row)=>sum+Number(row.line_total_before_gst),0).toFixed(2)),100.01);
  assert.equal(Number(lines.reduce((sum,row)=>sum+Number(row.internal_cost),0).toFixed(2)),80.02);
  const header=(await db.query("select * from quotes where id=$1",[quoteId])).rows[0];
  assert.equal(Number(header.grand_total),118.01);assert.equal(header.system_configuration_id,config);
  assert.equal((await db.query("select count(*)::int n from quotes where system_configuration_id=$1",[config])).rows[0].n,1);
  console.log("PASS A06/B04 exact assembly: three profile/beading lines, non-terminating cut average, residual costs/price/GST and idempotent retry.");
  await db.exec(`update quote_items set drawing_approval_status='Approved' where quote_id='${quoteId}'; update quotes set status='customer_approved' where id='${quoteId}';set test.actor='${sales}';set role authenticated;`);
  const orderId=(await db.query("select public.convert_quote_to_order_atomic($1,$2) as id",[quoteId,{order_date:"2026-10-08",order_value:999999}])).rows[0].id;
  await db.exec("reset role;");
  const orderLines=(await db.query("select * from order_items where order_id=$1 order by profile_id",[orderId])).rows;
  assert.equal(orderLines.length,3);
  assert.deepEqual(orderLines.map(row=>row.configuration_cut_snapshot),lines.map(row=>row.configuration_cut_snapshot));
  assert.deepEqual(orderLines.map(row=>row.source_line_id),lines.map(row=>row.id));
  assert.equal(Number((await db.query("select order_value from orders where id=$1",[orderId])).rows[0].order_value),118.01);
  const jobs=orderLines.map((row,index)=>({profile_id:row.profile_id,die_id:dies[index],source_line_id:row.id,planned_quantity_kg:Number(row.quantity_kg),planned_meters:Number(row.total_meters),remarks:`System configuration SC-QUOTE-TEST / ${index}`}));
  await db.exec(`set test.actor='${production}';set role authenticated;`);
  await assert.rejects(db.query("select public.handoff_system_configuration_to_production_atomic($1,$2,$3)",[config,jobs.slice(0,2),"SC-QUOTE-TEST"]),/every commercial profile/);
  await assert.rejects(db.query("select public.handoff_system_configuration_to_production_atomic($1,$2,$3)",[config,jobs.map((job,index)=>index?job:{...job,planned_meters:12}),"SC-QUOTE-TEST"]),/exact configuration/);
  assert.equal((await db.query("select public.handoff_system_configuration_to_production_atomic($1,$2,$3) as id",[config,jobs,"SC-QUOTE-TEST"])).rows[0].id,orderId);
  assert.equal((await db.query("select public.handoff_system_configuration_to_production_atomic($1,$2,$3) as id",[config,jobs,"SC-QUOTE-TEST"])).rows[0].id,orderId);
  await db.exec("reset role;");
  const actualJobs=(await db.query("select profile_id,source_line_id,planned_quantity_kg,planned_meters,pieces from production_jobs where order_id=$1 order by profile_id",[orderId])).rows;
  assert.equal(actualJobs.length,3);assert.deepEqual(actualJobs.map(row=>row.source_line_id),orderLines.map(row=>row.id));
  assert.deepEqual(actualJobs.map(row=>Number(row.pieces)),[3,3,5]);
  console.log("PASS B04 real conversion/handoff: exact source lines and immutable cuts copied into canonical order and three planned jobs; forged order total ignored.");
  await db.exec(`set test.actor='${owner}';`);
  await assert.rejects(db.query("update quote_items set configuration_cut_snapshot='[]'::jsonb where id=$1",[lines[0].id]),/immutable/);
  await assert.rejects(db.query("update order_items set quantity_pieces=1 where id=$1",[orderLines[0].id]),/immutable/);
  await db.exec(`set test.actor='${owner}';
    create function private.inject_quote_failure() returns trigger language plpgsql as $$begin if new.profile_id='${profiles[1]}' then raise exception 'Injected second-line failure';end if;return new;end;$$;
    create trigger inject_quote_failure before insert on quote_items for each row execute function private.inject_quote_failure();
    insert into system_configurations select (jsonb_populate_record(null::system_configurations,to_jsonb(c)||jsonb_build_object('id','${id(40)}','quote_id',null,'order_id',null,'status','calculated'))).* from system_configurations c where id='${config}';
    insert into system_profile_cuts select (jsonb_populate_record(null::system_profile_cuts,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'configuration_id','${id(40)}'))).* from system_profile_cuts c where configuration_id='${config}';
    set role authenticated;`);
  await assert.rejects(generate(id(40)),/Injected second-line/);
  await db.exec("reset role;");
  assert.equal((await db.query("select count(*)::int n from quotes where system_configuration_id=$1",[id(40)])).rows[0].n,0);
  assert.equal((await db.query("select quote_id from system_configurations where id=$1",[id(40)])).rows[0].quote_id,null);
  await db.exec("drop trigger inject_quote_failure on quote_items;");
  let roundingId=50;
  for(const rate of [0,0.25,5,12,18,28]) for(const subtotal of [100.02,101.05,999.99,1000.01,57.57]) {
    const nextConfig=id(roundingId++);
    await db.query(`insert into system_configurations select (jsonb_populate_record(null::system_configurations,to_jsonb(c)||jsonb_build_object(
      'id',$1::uuid,'configuration_number','SC-ROUND-'||$1::text,'quote_id',null,'order_id',null,'status','calculated',
      'subtotal',$2::numeric,'gst_percent',$3::numeric,'gst_amount',round($2::numeric*$3::numeric/100,2),
      'grand_total',$2::numeric+round($2::numeric*$3::numeric/100,2)))).* from system_configurations c where id=$4`,[nextConfig,subtotal,rate,config]);
    for(const table of ["system_profile_cuts","system_beading_cuts"]) await db.query(`insert into ${table} select (jsonb_populate_record(null::${table},to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'configuration_id',$1::uuid))).* from ${table} c where configuration_id=$2`,[nextConfig,config]);
    await db.exec("set role authenticated;");const nextQuote=await generate(nextConfig);await db.exec("reset role;");
    const totals=(await db.query("select total_before_gst,gst_amount,grand_total from quotes where id=$1",[nextQuote])).rows[0];
    assert.equal(Number(totals.total_before_gst),subtotal);
    assert.equal(Number(totals.gst_amount),Math.round((subtotal*rate/100+Number.EPSILON)*100)/100);
    assert.equal(Number(totals.grand_total),Number((subtotal+Number(totals.gst_amount)).toFixed(2)));
    assert.equal((await db.query("select count(*)::int n from quote_items where quote_id=$1 and line_total_before_gst>0",[nextQuote])).rows[0].n,3);
  }
  console.log("PASS B04 rounding: thirty price/rate cases including100.02 preserve exact agreed subtotal/GST/grand total without changing quantity or tax rate.");
  await db.exec(`update system_configurations set internal_cost=null where id='${id(40)}';set role authenticated;`);
  await assert.rejects(generate(id(40)),/must reconcile/);
  await db.exec(`reset role;update system_configurations set internal_cost=80.02 where id='${id(40)}';`);
  console.log("PASS A06 rollback: injected second-line failure leaves no quote/header/link orphan and preserves the existing successful assembly.");
  for(const user of [sales,production,suspended]) {
    await db.exec(`set test.actor='${user}';set role authenticated;`);
    await assert.rejects(generate(id(40)),/Only owners|Authentication required/);
    await db.exec("reset role;");
  }
  await db.exec(`set test.actor='${owner}';set role authenticated;`);
  await assert.rejects(generate(other),/not found/);
  await db.exec("reset role;set role anon;");
  await assert.rejects(generate(),/permission denied/);
  await db.exec("reset role;");
  await db.exec(`set test.actor='${sales}';set role authenticated;`);
  const salesLine=(await db.query("select * from order_items_authorized where id=$1",[orderLines[0].id])).rows[0];
  assert.equal(salesLine.internal_cost,null);assert.equal(salesLine.other_charges,null);assert.equal(salesLine.basic_price,null);
  assert.equal(Number(salesLine.final_line_value),Number(lines[0].line_total_before_gst));
  assert.deepEqual(salesLine.configuration_cut_snapshot,lines[0].configuration_cut_snapshot);
  const salesQuoteLine=(await db.query("select * from quote_items_authorized where id=$1",[lines[0].id])).rows[0];
  assert.equal(salesQuoteLine.line_subtotal,null);assert.equal(salesQuoteLine.billet_rate_per_kg,null);
  await db.exec("reset role;");
  console.log("PASS A06 authority: active owner/admin only, foreign/missing/suspended rejection and anonymous EXECUTE denial.");
  await db.exec("create view public.unexpected_cut_dependency as select length_per_piece_m from quote_items;");
  await assert.rejects(db.exec(migration),/Unexpected.*depend|unexpected.*depend/);
  await db.exec("rollback;");
  assert.equal((await db.query("select count(*)::int n from quotes where id=$1",[quoteId])).rows[0].n,1);
  console.log("PASS precision migration: repeat application preserves masks/grants/data and unknown view dependencies fail closed without CASCADE.");
} catch(error) { console.error(error.message); if(error.where) console.error(error.where); process.exitCode=1; }
finally { await db.close(); }

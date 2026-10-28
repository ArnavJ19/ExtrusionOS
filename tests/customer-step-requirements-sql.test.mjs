import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGuidedFixture,eids} from '../scripts/lib/guided-sop-fixture.mjs';
let f, customer,order,requirement;
test.before(async()=>{
 f=await createGuidedFixture();await f.db.exec(`create table customers(id uuid primary key,company_id uuid);
 alter table orders add column customer_id uuid;alter table orders add column deleted_at timestamptz;
 alter table production_jobs add column order_id uuid;alter table quality_inspections add column finishing_job_id uuid;
 create table finishing_jobs(id uuid primary key,company_id uuid,order_id uuid);
 create table packaging_jobs(id uuid primary key,company_id uuid,order_id uuid,status text);
 create table customer_compliance_requirements(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,certificate_type text,description text,is_mandatory boolean default true,is_active boolean default true,updated_at timestamptz default now());`);
 await f.db.exec(readFileSync('supabase/migrations/20261028030000_customer_step_requirements.sql','utf8'));
});
test.beforeEach(async()=>{await f.db.exec('truncate order_requirement_acknowledgements,customer_compliance_requirements,customers,packaging_jobs,finishing_jobs cascade');await f.reset();customer=f.nextId();order=f.nextId();requirement=f.nextId();await f.db.query('insert into customers values($1,$2)',[customer,eids.company]);await f.db.query("insert into orders(id,company_id,customer_id,current_stage) values($1,$2,$3,'packing')",[order,eids.company,customer]);});
test.after(async()=>f?.close());
const cmd=async(name,p,actor=eids.owner)=>(await f.asUser('select public.customer_requirement_command($1,$2) data',[name,p],actor))[0].data;
const save=(overrides={})=>cmd('requirement.save',{id:requirement,customer_id:customer,title:'Hardness certificate',description:'Confirm the batch hardness and attach inspection reference',stages:['production','quality','packing','dispatch'],is_mandatory:true,is_active:true,...overrides});
const ack=(stage,rev=1,actor=eids.owner)=>cmd('acknowledge',{order_id:order,stage,requirement_id:requirement,expected_revision:rev,note:'Inspection reference and batch trace reviewed'},actor);
test('57: requirements are paged and filtered on the server; filtered edits load their exact record',async()=>{
 const ids=[];for(let n=0;n<12;n++){const id=f.nextId();ids.push(id);await save({id,title:`Requirement ${String(n).padStart(2,'0')}`,is_active:n!==11});}
 const page=await cmd('customer.list',{customer_id:customer,page:2});assert.equal(page.rows.length,2);assert.equal(page.total_count,12);
 const filtered=await cmd('customer.list',{customer_id:customer,status:'inactive',search:'11'});assert.equal(filtered.total_count,1);
 const exact=await cmd('requirement.load',{customer_id:customer,id:ids[11]});assert.equal(exact.id,ids[11]);
 assert.equal((await cmd('order.list',{order_id:order,stage:'quality',status:'needs_review'})).total_count,11);
 assert.equal((await cmd('customer.list',{customer_id:customer,search:'%'})).total_count,0);
 await assert.rejects(cmd('customer.list',{customer_id:customer,page:0}),/Invalid page/);
});
test('57: current customer requirements appear at the relevant step and gate real production and dispatch',async()=>{
 await save();const job=f.nextId();await f.db.query("insert into production_jobs(id,company_id,order_id,status) values($1,$2,$3,'ready')",[job,eids.company,order]);
 await assert.rejects(f.db.query("update production_jobs set status='in_progress' where id=$1",[job]),/Review current customer requirements for production/);
 await ack('production');await f.db.query("update production_jobs set status='in_progress' where id=$1",[job]);
 const rows=await cmd('order.list',{order_id:order,stage:'production'},eids.operator);assert.equal(rows.rows[0].acknowledgement.by,'Owner Rao');
 await assert.rejects(f.db.query("insert into dispatches(id,company_id,order_id,delivery_status) values($1,$2,$3,'dispatched')",[f.nextId(),eids.company,order]),/requirements for dispatch/);
 await ack('dispatch');await f.db.query("insert into dispatches(id,company_id,order_id,delivery_status) values($1,$2,$3,'dispatched')",[f.nextId(),eids.company,order]);
});
test('57: changed requirements invalidate old acknowledgements but retain their exact snapshots',async()=>{
 await save();await ack('packing');await save({expected_revision:1,description:'Confirm hardness and film thickness for this batch'});
 await assert.rejects(ack('packing',1),/requirement changed/);
 await assert.rejects(f.db.query("insert into packaging_jobs values($1,$2,$3,'completed')",[f.nextId(),eids.company,order]),/requirements for packing/);
 await ack('packing',2);await f.db.query("insert into packaging_jobs values($1,$2,$3,'completed')",[f.nextId(),eids.company,order]);
 assert.equal((await f.db.query('select count(*)::int n from order_requirement_acknowledgements')).rows[0].n,2);
});
test('57: role scope, tenancy, optional requirements and stale master saves',async()=>{
 await save({is_mandatory:false});const job=f.nextId();await f.db.query("insert into production_jobs(id,company_id,order_id,status) values($1,$2,$3,'in_progress')",[job,eids.company,order]);
 await assert.rejects(cmd('order.list',{order_id:order,stage:'dispatch'},eids.operator),/outside your role/);
 await assert.rejects(cmd('order.list',{order_id:order,stage:'production'},eids.foreign),/Order is unavailable/);
 await assert.rejects(save({expected_revision:9}),/requirement changed/);
 await assert.rejects(cmd('customer.list',{customer_id:customer},eids.dealer),/not permitted/);
 await f.db.query('update app_users set dealer_id=null where id=$1',[eids.dealer]);
 await assert.rejects(cmd('customer.list',{customer_id:customer},eids.dealer),/not permitted/,'an unattached dealer role is still external');
 await assert.rejects(f.asUser('select * from order_requirement_acknowledgements'),/permission denied/);
});

for (const scenario of ['another company','another customer','a competing new requirement']) {
 test(`57: a save cannot overwrite ${scenario} inserted after its ownership check`,async()=>{
  const winnerCompany=scenario==='another company'?eids.otherCompany:eids.company;
  const winnerCustomer=scenario==='a competing new requirement'?customer:f.nextId();
  if(winnerCustomer!==customer)await f.db.query('insert into customers values($1,$2)',[winnerCustomer,winnerCompany]);
  await f.db.query("select set_config('test.requirement_company',$1,false),set_config('test.requirement_customer',$2,false)",[winnerCompany,winnerCustomer]);
  // Model the competing insert after the initial read; PGlite has one session.
  const original=(await f.db.query("select pg_get_functiondef('public.customer_requirement_command(text,jsonb)'::regprocedure) source")).rows[0].source;
  const insert='  insert into public.customer_compliance_requirements(id,company_id,customer_id,certificate_type,description,is_mandatory,is_active,work_stages)';
  const interleaved=original.replace(insert,`  insert into public.customer_compliance_requirements(id,company_id,customer_id,certificate_type,description,work_stages)
   values(v_id,current_setting('test.requirement_company')::uuid,current_setting('test.requirement_customer')::uuid,'Winning requirement','Preserve the winning instruction',v_stages);
${insert}`);
  assert.notEqual(interleaved,original,'the fixture must place its insert after the ownership read');
  await f.db.exec(interleaved);
  try {
   await assert.rejects(save({expected_revision:1}),/requirement changed/);
   assert.equal((await f.db.query('select count(*)::int n from customer_compliance_requirements')).rows[0].n,0,'the refused write rolls back its test interleaving');
  } finally {
   await f.db.exec(original);
  }
 });
}

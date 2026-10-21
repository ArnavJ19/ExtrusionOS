import test from "node:test";
import assert from "node:assert/strict";
import { createInTaskCustomerActionFixture, customerFixtureIds as ids } from "../scripts/lib/in-task-customer-action-fixture.mjs";

let f;
const customer={customer_name:"Arun Windows",company_name:"Arun Aluminium",customer_type:"fabricator",phone:"+91 98765 43210",gst_number:"27ABCDE1234F1Z5",billing_address:"Fixture billing address",shipping_address:"Fixture site"};
const create=(extra={})=>({intent:"create",customer,request_id:ids.request,acknowledge_similar:false,...extra});
test.before(async()=>{f=await createInTaskCustomerActionFixture()});
test.beforeEach(async()=>{await f.db.exec("truncate customers");Object.assign(f.state,{role:"owner",companyId:ids.company,userId:ids.user,authenticated:true,calls:[],paths:[],inserts:0,throwAfterWrite:false,readError:false,insertError:null});});
test.after(async()=>{await f?.close()});

test("creation derives tenant and author, normalizes contacts, and returns a minimal selection",async()=>{
  const result=await f.action(create());assert.equal(result.kind,"created");assert.equal(result.customer.id,ids.request);assert.equal(result.customer.phone,"9876543210");
  assert.equal(f.state.inserts,1);const rows=(await f.db.query("select * from customers")).rows;
  assert.equal(rows[0].company_id,ids.company);assert.equal(rows[0].created_by,ids.user);
  assert.equal("company_id" in result.customer,false);assert.equal("created_by" in result.customer,false);
  assert.deepEqual(f.state.paths,["/customers","/customers/database"]);
});
test("role and authentication denials make no reads or writes",async()=>{
  for(const role of ["viewer","accounts","production","dealer_admin","dealer_staff"]){f.state.role=role;const r=await f.action(create());assert.equal(r.kind,"error");}
  f.state.authenticated=false;assert.equal((await f.action(create())).kind,"error");assert.equal(f.state.calls.length,0);
});
test("strict input validation rejects tenant injection, bad contacts and identities",async()=>{
  for(const request of [create({company_id:ids.otherCompany}),create({customer:{...customer,company_id:ids.otherCompany}}),create({customer:{...customer,phone:"123"}}),create({request_id:"bad"}),create({customer:{...customer,gst_number:"BAD"}})])assert.equal((await f.action(request)).kind,"error");
  assert.equal(f.state.calls.length,0);
});
test("duplicate evidence is scoped, bounded, and requires explicit review",async()=>{
  await f.seed({customer_name:customer.customer_name,gst_number:customer.gst_number,phone:"9876543210"});
  await f.seed({id:"30000000-0000-4000-8000-000000000003",company_id:ids.otherCompany,customer_name:customer.customer_name,gst_number:customer.gst_number});
  const checked=await f.action({intent:"check",customer});assert.equal(checked.kind,"checked");assert.equal(checked.matches.length,1);assert.ok(checked.matches[0].matched_on.includes("GST"));
  for(const field of ["email","billing_address","shipping_address","created_by","company_id"])assert.equal(field in checked.matches[0],false);
  assert.equal((await f.action(create())).kind,"similar");assert.equal(f.state.inserts,0);
  const created=await f.action(create({acknowledge_similar:true}));assert.equal(created.kind,"created");assert.equal(f.state.inserts,1);
});
test("read failures are unavailable rather than evidence of no duplicates",async()=>{
  f.state.readError=true;const result=await f.action(create());assert.equal(result.kind,"error");assert.equal(result.uncertain,false);assert.equal(f.state.inserts,0);
});
test("legacy phone formatting and escaped name wildcards stay reviewable and bounded",async()=>{
  await f.seed({customer_name:"Different contact",phone:"+91 98765 43210"});
  const checked=await f.action({intent:"check",customer:{...customer,customer_name:"Literal % _ buyer",gst_number:""}});
  assert.equal(checked.kind,"checked");assert.equal(checked.matches.length,1);assert.deepEqual(checked.matches[0].matched_on,["phone"]);
  assert.ok(f.state.calls.every(call=>call.limit===11));
});
test("definite policy rejection is editable rather than an ambiguous commit",async()=>{
  f.state.insertError="42501";const result=await f.action(create());assert.equal(result.kind,"error");assert.notEqual(result.uncertain,true);assert.equal(f.state.inserts,0);
});
test("simultaneous requests with one identity produce one customer",async()=>{
  const results=await Promise.all([f.action(create()),f.action(create())]);assert.ok(results.every(result=>result.kind==="created"));assert.equal(f.state.inserts,1);
  assert.equal((await f.db.query("select count(*)::int as count from customers")).rows[0].count,1);
});
test("lost confirmation retries the same author and identity without another insert",async()=>{
  f.state.throwAfterWrite=true;const lost=await f.action(create());assert.equal(lost.kind,"error");assert.equal(lost.uncertain,true);assert.equal(f.state.inserts,1);
  f.state.throwAfterWrite=false;const replay=await f.action(create());assert.equal(replay.kind,"created");assert.equal(f.state.inserts,1);
  assert.equal((await f.action(create({customer:{...customer,customer_name:"Changed"}}))).kind,"error");assert.equal(f.state.inserts,1);
  f.state.userId=ids.otherUser;assert.equal((await f.action(create())).kind,"error");assert.equal(f.state.inserts,1);
});
test("select rechecks activity, deletion and company scope",async()=>{
  await f.seed({});assert.equal((await f.action({intent:"select",customer_id:ids.existing})).kind,"selected");
  await f.db.query("update customers set is_active=false where id=$1",[ids.existing]);assert.equal((await f.action({intent:"select",customer_id:ids.existing})).kind,"error");
  await f.db.query("update customers set is_active=true,deleted_at=now() where id=$1",[ids.existing]);assert.equal((await f.action({intent:"select",customer_id:ids.existing})).kind,"error");
  await f.db.query("update customers set deleted_at=null,company_id=$1 where id=$2",[ids.otherCompany,ids.existing]);assert.equal((await f.action({intent:"select",customer_id:ids.existing})).kind,"error");
});
test("the actual existing customer RLS denies cross-company writes and unprivileged inserts",async()=>{
  async function insertAs(role,company){await f.db.exec("begin");try{await f.db.query("select set_config('test.user_id',$1,true),set_config('test.company_id',$2,true),set_config('test.role',$3,true)",[ids.user,ids.company,role]);await f.db.exec("set local role authenticated");await f.db.query("insert into customers(id,company_id,created_by,customer_name,customer_type) values($1,$2,$3,'Forbidden','fabricator')",[ids.request,company,ids.user]);throw new Error("Unexpected permitted insert");}finally{await f.db.exec("rollback")}}
  await assert.rejects(insertAs("owner",ids.otherCompany),/row-level security/);await assert.rejects(insertAs("viewer",ids.company),/row-level security/);
});

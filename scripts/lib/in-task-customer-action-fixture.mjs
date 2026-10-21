import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const customerFixtureIds = {
  company: "10000000-0000-4000-8000-000000000001", otherCompany: "10000000-0000-4000-8000-000000000002",
  user: "20000000-0000-4000-8000-000000000001", otherUser: "20000000-0000-4000-8000-000000000002",
  request: "30000000-0000-4000-8000-000000000001", existing: "30000000-0000-4000-8000-000000000002",
};

export async function createInTaskCustomerActionFixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable as $$select nullif(current_setting('test.company_id',true),'')::uuid$$;
    create function private.get_current_user_role() returns text language sql stable as $$select current_setting('test.role',true)$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable as $$select null::uuid$$;
    create table customers (
      id uuid primary key, company_id uuid not null, created_by uuid not null, customer_name text not null,
      company_name text, customer_type text not null, phone text, email text, gst_number text,
      billing_address text, shipping_address text, city text, state text, pincode text,
      is_active boolean not null default true, deleted_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table quotes(company_id uuid, customer_id uuid, dealer_id uuid);
    create table orders(company_id uuid, customer_id uuid, dealer_id uuid);
    alter table customers enable row level security;
    grant usage on schema public,auth,private to authenticated;
    grant select,insert on customers to authenticated; grant select on quotes,orders to authenticated;
    grant execute on all functions in schema auth,private to authenticated;
  `);
  const policySource = readFileSync("supabase/migrations/20261008010000_access_projection_integrity.sql", "utf8");
  await db.exec(policySource.slice(policySource.indexOf("create policy customers_access_read"), policySource.indexOf("create policy quotes_access_read")));
  const state = { role: "owner", companyId: customerFixtureIds.company, userId: customerFixtureIds.user, authenticated: true, calls: [], paths: [], inserts: 0, throwAfterWrite: false, readError: false, insertError: null };

  async function execute(call) {
    state.calls.push(structuredClone(call));
    if (state.readError && !call.insert) return { data: null, error: { message: "Synthetic read failure" } };
    if (state.insertError && call.insert) return { data: null, error: { code: state.insertError, message: "Synthetic insert rejection" } };
    assert.equal(call.table, "customers");
    const columns = call.columns.split(",").map(value => value.trim());
    const identifiers = new Set(["id","company_id","created_by","customer_name","company_name","customer_type","phone","email","gst_number","billing_address","shipping_address","city","state","pincode","is_active","deleted_at"]);
    for (const column of columns) assert.ok(identifiers.has(column), `Unexpected projected field ${column}`);
    let result;
    try {
      await db.exec("begin");
      await db.query("select set_config('test.user_id',$1,true),set_config('test.company_id',$2,true),set_config('test.role',$3,true)", [state.userId, state.companyId, state.role]);
      await db.exec("set local role authenticated");
      if (call.insert) {
        const fields = Object.keys(call.insert);
        fields.forEach(field => assert.ok(identifiers.has(field)));
        result = await db.query(`insert into customers (${fields.join(",")}) values (${fields.map((_,i)=>`$${i+1}`).join(",")}) returning ${columns.join(",")}`, fields.map(field=>call.insert[field]));
      } else {
        const args=[];
        const clauses=call.filters.map(([kind,field,value])=>{
          assert.ok(identifiers.has(field));
          if(kind==="is") { assert.equal(value,null);return `${field} is null`; }
          if(kind==="in") { const slots=value.map(entry=>{args.push(entry);return `$${args.length}`});return `${field} in (${slots.join(",")})`; }
          args.push(value);return `${field} ${kind==="ilike"?"ilike":"="} $${args.length}`;
        });
        assert.ok(call.filters.some(([,field,value])=>field==="company_id"&&value===state.companyId));
        assert.ok(call.filters.some(([kind,field])=>kind==="is"&&field==="deleted_at"));
        assert.ok(call.single || call.limit===11, "Every multi-record lookup must be bounded");
        result=await db.query(`select ${columns.join(",")} from customers where ${clauses.join(" and ")}${call.order?" order by id":""}${call.limit?` limit ${call.limit}`:""}`, args);
      }
      await db.exec("commit");
      if(call.insert) {state.inserts++;if(state.throwAfterWrite)throw new Error("Synthetic response lost after commit");}
    } catch(error) {
      await db.exec("rollback");
      if(state.throwAfterWrite && call.insert)throw error;
      return {data:null,error:{code:error.code,message:error.message}};
    }
    return { data: call.single ? result.rows[0]??null : result.rows, error:null };
  }
  let statementQueue=Promise.resolve();
  const client={from(table){const call={table,columns:"",filters:[],single:false,limit:null,order:null};let pending;const q={
    select(columns){call.columns=columns;return q},eq(field,value){call.filters.push(["eq",field,value]);return q},
    is(field,value){call.filters.push(["is",field,value]);return q},ilike(field,value){call.filters.push(["ilike",field,value]);return q},
    in(field,value){call.filters.push(["in",field,value]);return q},order(field){call.order=field;return q},limit(value){call.limit=value;return q},
    insert(value){call.insert=value;return q},maybeSingle(){call.single=true;return q},single(){call.single=true;return q},
    then(resolve,reject){if(!pending){pending=statementQueue.then(()=>execute(call));statementQueue=pending.catch(()=>undefined);}return pending.then(resolve,reject)}
  };return q;}};
  const require=createRequire(import.meta.url); require("tsx/cjs");
  const Module=require("node:module"),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="@/lib/auth")return {getSessionContext:async()=>{if(!state.authenticated)throw new Error("Auth required");return {userId:state.userId,companyId:state.companyId,role:state.role,dealerId:null}}};
    if(request==="@/lib/supabase/server")return {createClient:async()=>client};
    if(request==="next/cache")return {revalidatePath:path=>state.paths.push(path)};
    return original(request,parent,isMain);
  };
  let action;try{const path=require.resolve("../../lib/actions/in-task-customers.ts");delete require.cache[path];action=require(path).inTaskCustomerAction;}finally{Module._load=original;}
  return {db,state,action,async seed(row){const value={id:customerFixtureIds.existing,company_id:state.companyId,created_by:state.userId,customer_name:"Kaveri Fabrication",customer_type:"fabricator",...row};const keys=Object.keys(value);await db.query(`insert into customers (${keys.join(",")}) values (${keys.map((_,i)=>`$${i+1}`).join(",")})`,keys.map(key=>value[key]));},async close(){await db.close();}};
}

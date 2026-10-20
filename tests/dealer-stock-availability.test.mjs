import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1),otherCompany=id(2),dealer=id(3),otherDealer=id(4),quote=id(5),otherQuote=id(6);
const profile=id(7),secondProfile=id(8),batch=id(9),reservation=id(10),foreignReservation=id(11);
const roles=["owner","sales","dealer_admin","dealer_staff","dispatch_manager","production_manager","accounts","viewer","quality","unknown"];
const users = new Map(roles.map((role,index)=>[role,id(100+index)]));
const suspended=id(120), sibling=id(121);
const migration=readFileSync(new URL("../supabase/migrations/20261013000000_audit_workflow_followup.sql",import.meta.url),"utf8");

describe("authorized dealer stock availability", () => {
  const db=new PGlite();
  const identity=async user=>db.exec(`reset role; select set_config('test.uid','${user ?? ""}',false);set role authenticated;`);
  const availability=async selectedQuote=>(await db.query("select public.get_dealer_quote_stock_availability($1) amount",[selectedQuote ?? quote])).rows[0].amount;

  before(async()=>{
    await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
      grant usage on schema auth,public to authenticated;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table app_users(id uuid primary key,company_id uuid,role text,dealer_id uuid,is_active boolean);
      create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_role() returns text language sql security definer as $$select role from app_users where id=auth.uid() and is_active$$;
      create function private.get_current_user_dealer_id() returns uuid language sql security definer as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
      create table quotes(id uuid primary key,company_id uuid,dealer_id uuid,status text,deleted_at timestamptz);
      create table quote_items(id uuid primary key,company_id uuid,quote_id uuid,profile_id uuid,finishing_type text,billing_weight_kg numeric,total_weight_kg numeric);
      create table profile_stock_batches(id uuid primary key,company_id uuid,dealer_id uuid,profile_id uuid,finish text,total_weight_kg numeric,status text);
      create table profile_stock_reservations(id uuid primary key,company_id uuid,profile_stock_batch_id uuid,reserved_weight_kg numeric,status text);
      create table profile_stock_consumptions(id uuid primary key,company_id uuid,reservation_id uuid,consumed_weight_kg numeric,consumed_length_m numeric,consumed_pieces integer);
      insert into quotes values('${quote}','${company}','${dealer}','customer_approved',null),('${otherQuote}','${company}','${otherDealer}','customer_approved',null),('${id(20)}','${otherCompany}','${dealer}','customer_approved',null),('${id(21)}','${company}',null,'customer_approved',null),('${id(22)}','${company}','${dealer}','draft',null),('${id(23)}','${company}','${dealer}','customer_approved',now());
      insert into quote_items values
        ('${id(30)}','${company}','${quote}','${profile}','mill_finish',50,999),
        ('${id(31)}','${company}','${quote}','${profile}','Mill Finish',20,999),
        ('${id(32)}','${company}','${quote}','${secondProfile}','Powder Coating',40,999),
        ('${id(33)}','${otherCompany}','${quote}','${profile}','mill_finish',999,999);
      insert into profile_stock_batches values
        ('${batch}','${company}','${dealer}','${profile}','mill_finish',40,'reserved'),
        ('${id(40)}','${company}','${dealer}','${profile}','Mill Finish',15,'available'),
        ('${id(41)}','${company}','${dealer}','${secondProfile}','powder_coating',30,'available'),
        ('${id(42)}','${company}','${dealer}','${profile}','powder_coating',999,'available'),
        ('${id(43)}','${company}','${dealer}','${profile}','mill_finish',999,'rejected'),
        ('${id(44)}','${company}','${otherDealer}','${profile}','mill_finish',999,'available'),
        ('${id(45)}','${otherCompany}','${dealer}','${profile}','mill_finish',999,'available');
      insert into profile_stock_reservations values('${reservation}','${company}','${batch}',30,'active'),('${id(50)}','${company}','${batch}',999,'released'),('${foreignReservation}','${otherCompany}','${batch}',999,'active');
      insert into profile_stock_consumptions values('${id(60)}','${company}','${reservation}',10,5,1),('${id(61)}','${otherCompany}','${reservation}',999,999,999);
      insert into app_users values('${suspended}','${company}','owner',null,false),('${sibling}','${company}','dealer_admin','${otherDealer}',true);`);
    for (const [role,user] of users) await db.query("insert into app_users values($1,$2,$3,$4,true)",[user,company,role,role.startsWith("dealer_")?dealer:null]);
    await db.exec(migration);
    await db.exec(migration);
  });
  beforeEach(async()=>identity(users.get("owner")));
  after(async()=>db.close());

  it("reconciles partially consumed holds and free reserved batches by exact profile and finish",async()=>{
    assert.equal(Number(await availability()),65);
    await identity(users.get("dealer_staff"));
    assert.equal(Number(await availability()),65);
    await assert.rejects(db.query("select * from profile_stock_reservations"),/permission denied/);
  });

  it("caps every profile/finish supply to its own demand without multiplying repeated lines",async()=>{
    await db.exec("reset role;begin;");
    try {
      await db.query("update profile_stock_batches set total_weight_kg=1000 where id=$1",[batch]);
      await db.exec("set role authenticated;");
      assert.equal(Number(await availability()),100);
    } finally {await db.exec("reset role;rollback;");}
  });

  it("returns a verified zero for approved non-dealer quotes",async()=>{
    assert.equal(Number(await availability(id(21))),0);
  });

  it("rejects sibling dealer, foreign company, missing, deleted and unapproved quotes",async()=>{
    await identity(users.get("dealer_admin"));
    for (const selected of [otherQuote,id(20),id(999),id(23)]) await assert.rejects(availability(selected),/Quote not found/);
    await assert.rejects(availability(id(22)),/customer-approved/);
    await identity(sibling);
    await assert.rejects(availability(),/Quote not found/);
  });

  it("requires active identities and restricts operational roles and anonymous execution",async()=>{
    for (const user of [users.get("quality"),users.get("unknown"),users.get("production_manager")]) {
      await identity(user);await assert.rejects(availability(),/Permission denied/);
    }
    for (const user of [suspended,null]) {await identity(user);await assert.rejects(availability(),/Authentication required/);}
    await db.exec("reset role;set role anon;");
    await assert.rejects(availability(),/permission denied/);
  });

  it("allows commercial reads but keeps reservation consumption behind inventory read capabilities",async()=>{
    for (const role of ["sales","accounts","viewer","dealer_admin","dealer_staff"]) {
      await identity(users.get(role));assert.equal(Number(await availability()),65);
      await assert.rejects(db.query("select * from get_profile_stock_consumption_totals($1)",[[reservation]]),/Permission denied/);
    }
    for (const role of ["owner","dispatch_manager","production_manager"]) {
      await identity(users.get(role));
      const result=await db.query("select * from get_profile_stock_consumption_totals($1)",[[reservation]]);
      assert.deepEqual(result.rows.map(row=>[row.reservation_id,Number(row.consumed_weight_kg),Number(row.consumed_length_m),row.consumed_pieces]),[[reservation,10,5,1]]);
    }
  });

  it("rejects foreign, repeated, null and oversized reservation requests",async()=>{
    for (const ids of [[foreignReservation],[reservation,reservation],[null],Array.from({length:501},(_,n)=>id(1000+n))]) {
      await assert.rejects(db.query("select * from get_profile_stock_consumption_totals($1)",[ids]),/current company|unique|no more than 500/);
    }
    assert.equal((await db.query("select * from get_profile_stock_consumption_totals($1)",[[]])).rows.length,0);
  });
});

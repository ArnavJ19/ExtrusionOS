import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const bid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const bids = {
  company: bid(1), otherCompany: bid(2), owner: bid(10), inventory: bid(11), sales: bid(12), viewer: bid(13), dealer: bid(14), otherDealerUser: bid(15), foreign: bid(16),
  dealerId: bid(700), otherDealerId: bid(701),
  profile: bid(20), customer: bid(21), order1: bid(30), order2: bid(31), dispatch1: bid(40),
  batch: bid(50), heldBatch: bid(51), overBatch: bid(52), dealerBatch: bid(53), dispatchedBatch: bid(54), foreignBatch: bid(55),
  r1: bid(60), r2: bid(61), r3: bid(62), r4: bid(63), rOver: bid(64), rHeld: bid(65), rLegacy: bid(66)
};

// Batch "B-100" started at 1000 kg / 100 pcs / 600 m. R1 (400 kg) has had 150 kg dispatched,
// R2 (200 kg) is untouched, R3 was released, a dealer debit of 50 kg stands and a 30 kg debit was
// credited back on cancellation. On hand is therefore 800 kg / 80 pcs / 480 m.
export async function createStockBalanceFixture() {
  const db = new PGlite();
  const f = bids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text,profile_name text);
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text);
    create table orders(id uuid primary key,company_id uuid,order_number text,customer_id uuid);
    create table dispatches(id uuid primary key,company_id uuid,dispatch_number text);
    create table profile_stock_batches(id uuid primary key,company_id uuid,profile_id uuid,bundle_number text,finish text,location text,status text,qc_status text,origin_type text,origin_reference text,created_at timestamptz,dealer_id uuid,total_weight_kg numeric,quantity_pieces integer,length_m numeric);
    create table profile_stock_reservations(id uuid primary key,company_id uuid,profile_stock_batch_id uuid,order_id uuid,status text,reserved_weight_kg numeric,reserved_pieces integer,reserved_length_m numeric,initial_reserved_weight_kg numeric,initial_reserved_pieces integer,initial_reserved_length_m numeric,created_at timestamptz);
    create table profile_stock_consumptions(id uuid primary key default gen_random_uuid(),company_id uuid,reservation_id uuid,profile_stock_batch_id uuid,order_id uuid,dispatch_id uuid,consumed_weight_kg numeric,consumed_pieces integer,consumed_length_m numeric,created_at timestamptz default now());
    create table order_dealer_stock_fulfillments(id uuid primary key default gen_random_uuid(),company_id uuid,order_id uuid,profile_stock_batch_id uuid,fulfilled_weight_kg numeric,fulfilled_pieces integer,fulfilled_length_m numeric,created_at timestamptz default now(),credited_at timestamptz,unit_rate numeric,quoted_line_value numeric);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022250000_profile_stock_balance_explanation.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.owner) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor]);
      await db.exec("set local role authenticated");
      const result = await db.query(sql, parameters);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.profile_stock_balance_command($1,$2) data", [name, payload], actor))[0].data;
  const explain = (batch = f.batch, actor = f.owner) => command("balance.explain", { batch_id: batch }, actor);

  async function reset() {
    await db.exec(`truncate order_dealer_stock_fulfillments,profile_stock_consumptions,profile_stock_reservations,profile_stock_batches,dispatches,orders,customers,aluminium_profiles,app_users,companies`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.inventory}','${f.company}','inventory_manager',true,'Stores',null),
        ('${f.sales}','${f.company}','sales',true,'Sales',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.dealer}','${f.company}','dealer_admin',true,'Dealer A','${f.dealerId}'),('${f.otherDealerUser}','${f.company}','dealer_staff',true,'Dealer B','${f.otherDealerId}'),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null);
      insert into aluminium_profiles values('${f.profile}','${f.company}','EX-101','Sliding track 3-track');
      insert into customers values('${f.customer}','${f.company}','Kumar','Kumar Facades');
      insert into orders values('${f.order1}','${f.company}','SO-0001','${f.customer}'),('${f.order2}','${f.company}','SO-0002','${f.customer}');
      insert into dispatches values('${f.dispatch1}','${f.company}','DSP-0001');
      insert into profile_stock_batches values
        ('${f.batch}','${f.company}','${f.profile}','B-100','powder coated','Rack A3','reserved','released','production_surplus','PJ-0007','2026-10-01T00:00:00Z',null,800,80,480),
        ('${f.heldBatch}','${f.company}','${f.profile}','B-200','mill','Rack B1','available','on_hold','production_surplus','PJ-0008','2026-10-02T00:00:00Z',null,300,30,180),
        ('${f.overBatch}','${f.company}','${f.profile}','B-300','mill','Rack B2','reserved','released','opening_balance',null,'2026-10-03T00:00:00Z',null,100,10,60),
        ('${f.dealerBatch}','${f.company}','${f.profile}','D-1','anodized','Dealer yard','available','not_required','dealer_manual',null,'2026-10-04T00:00:00Z','${f.dealerId}',90,9,54),
        ('${f.dispatchedBatch}','${f.company}','${f.profile}','B-400','mill','Gone','dispatched','released','production_surplus','PJ-0001','2026-09-01T00:00:00Z',null,0,0,0),
        ('${f.foreignBatch}','${f.otherCompany}',null,'F-1','mill','x','available','released','opening_balance',null,'2026-10-01T00:00:00Z',null,5,1,1);
      insert into profile_stock_reservations values
        ('${f.r1}','${f.company}','${f.batch}','${f.order1}','active',400,40,240,400,40,240,'2026-10-05T00:00:00Z'),
        ('${f.r2}','${f.company}','${f.batch}','${f.order2}','active',200,20,120,200,20,120,'2026-10-06T00:00:00Z'),
        ('${f.r3}','${f.company}','${f.batch}','${f.order2}','released',100,10,60,100,10,60,'2026-10-04T00:00:00Z'),
        ('${f.rOver}','${f.company}','${f.overBatch}','${f.order1}','active',130,13,78,130,13,78,'2026-10-07T00:00:00Z'),
        ('${f.rHeld}','${f.company}','${f.heldBatch}','${f.order1}','active',100,10,60,100,10,60,'2026-10-07T00:00:00Z');
      insert into profile_stock_consumptions(company_id,reservation_id,profile_stock_batch_id,order_id,dispatch_id,consumed_weight_kg,consumed_pieces,consumed_length_m,created_at)
        values('${f.company}','${f.r1}','${f.batch}','${f.order1}','${f.dispatch1}',150,15,90,'2026-10-10T00:00:00Z');
      insert into order_dealer_stock_fulfillments(company_id,order_id,profile_stock_batch_id,fulfilled_weight_kg,fulfilled_pieces,fulfilled_length_m,created_at,credited_at,unit_rate,quoted_line_value) values
        ('${f.company}','${f.order2}','${f.batch}',50,5,30,'2026-10-11T00:00:00Z',null,310,15500),
        ('${f.company}','${f.order2}','${f.batch}',30,3,18,'2026-10-12T00:00:00Z','2026-10-13T00:00:00Z',310,9300);`);
  }
  return { db, asUser, command, explain, reset, close: () => db.close() };
}

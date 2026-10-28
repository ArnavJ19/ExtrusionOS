import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const qid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const qids = {
  company: qid(1), otherCompany: qid(2), owner: qid(10), sales: qid(11), viewer: qid(12), dealer: qid(13), otherDealerUser: qid(14), production: qid(15), foreign: qid(16),
  dealer1: qid(700), dealer2: qid(701), customer: qid(20), profileA: qid(30), profileB: qid(31), quote: qid(40), dealerQuote: qid(41), foreignQuote: qid(42), order: qid(60)
};

// Minimal hosted-shaped schema: the original permissive revision policy, then the feature-25 migration.
export async function createQuoteRevisionFixture() {
  const db = new PGlite();
  const f = qids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function public.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table quotes(id uuid primary key,company_id uuid,quote_number text,customer_id uuid,dealer_id uuid,status text,revision_number integer,quote_date date,valid_until date,payment_terms text,delivery_timeline text,terms_and_conditions text,notes text,gst_percent numeric,subtotal numeric,total_before_gst numeric,gst_amount numeric,grand_total numeric,total_margin_amount numeric,estimated_profit_amount numeric,estimated_profit_percent numeric,approval_notes text,low_margin_approval_required boolean,approved_by uuid,approved_at timestamptz,sent_at timestamptz,customer_decision_at timestamptz,updated_at timestamptz default now(),deleted_at timestamptz);
    create table quote_items(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,profile_id uuid,die_id uuid,item_description text,section_code text,quantity_pieces integer,length_per_piece_m numeric,total_meters numeric,section_weight_kg_per_m numeric,total_weight_kg numeric,billing_weight_kg numeric,finishing_type text,finishing_charge_type text,price_per_kg numeric,line_total_before_gst numeric,billet_rate_per_kg numeric,margin_percent numeric,internal_note text,supplier_rate numeric,created_at timestamptz default now());
    create table quote_revisions(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,revision_number integer,snapshot_json jsonb not null,revised_by uuid,revised_at timestamptz not null default now(),reason text,pdf_url text,updated_at timestamptz default now(),unique(quote_id,revision_number));
    create table orders(id uuid primary key,company_id uuid,quote_id uuid,order_number text,created_at timestamptz default now());
    alter table quote_revisions enable row level security;
    create policy "quote revisions tenant read" on quote_revisions for select using (company_id = public.get_current_user_company_id());
    grant usage on schema public,private,auth to authenticated,anon;
    grant select on all tables in schema public to authenticated;
    grant execute on all functions in schema private,auth to authenticated;
    insert into companies values('${f.company}'),('${f.otherCompany}');
    insert into app_users values
      ('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
      ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.dealer}','${f.company}','dealer_admin',true,'Dealer One',${`'${f.dealer1}'`}),
      ('${f.otherDealerUser}','${f.company}','dealer_staff',true,'Dealer Two',${`'${f.dealer2}'`}),('${f.production}','${f.company}','production',true,'Press',null),
      ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null);`);
  await db.exec(readFileSync("supabase/migrations/20261022200000_quote_revision_comparison.sql", "utf8"));

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
  const compare = async (actor, quote, from, to) => (await asUser("select public.quote_revision_compare($1,$2,$3) data", [quote, from, to], actor))[0].data;

  async function reset() {
    await db.exec("truncate quotes,quote_items,quote_revisions,orders");
    const item = (quote, profile, pieces, length, finish, price, billet, created) =>
      `('${quote}','${f.company}','${profile}',${pieces},${length},${(pieces * length).toFixed(3)},0.8,${(pieces * length * 0.8).toFixed(3)},'${finish}',${price},${billet},22,'internal: supplier ABC',201,'${created}')`;
    const snapshotItems = [
      { profile_id: f.profileA, quantity_pieces: 100, length_per_piece_m: 6, total_meters: 600, section_weight_kg_per_m: 0.8, total_weight_kg: 480, finishing_type: "mill_finish", price_per_kg: 320, billet_rate_per_kg: 240, margin_percent: 20, internal_note: "internal: supplier ABC", supplier_rate: 199 },
      { profile_id: f.profileB, quantity_pieces: 40, length_per_piece_m: 5.8, total_meters: 232, section_weight_kg_per_m: 1.1, total_weight_kg: 255.2, finishing_type: "anodizing", price_per_kg: 360, billet_rate_per_kg: 240, margin_percent: 18 }
    ];
    await db.query(`insert into quotes(id,company_id,quote_number,customer_id,dealer_id,status,revision_number,payment_terms,gst_percent,grand_total,total_margin_amount,notes,approved_by)
      values($1,$2,'Q-0001',$3,null,'draft',2,'30 days',18,250000,40000,'Call before dispatch',null),
            ($4,$2,'Q-0002',$3,$5,'draft',2,'Advance',18,90000,9000,'Dealer internal',null),
            ($6,$7,'Q-F',null,null,'draft',2,'FOREIGN',18,1,1,'FOREIGN',null)`,
      [f.quote, f.company, f.customer, f.dealerQuote, f.dealer1, f.foreignQuote, f.otherCompany]);
    await db.exec(`insert into quote_items(quote_id,company_id,profile_id,quantity_pieces,length_per_piece_m,total_meters,section_weight_kg_per_m,total_weight_kg,finishing_type,price_per_kg,billet_rate_per_kg,margin_percent,internal_note,supplier_rate,created_at) values
      ${item(f.quote, f.profileA, 120, 6, "powder_coating", 335, 250, "2026-10-01T10:00:00Z")},
      ${item(f.dealerQuote, f.profileA, 10, 6, "mill_finish", 300, 240, "2026-10-01T10:00:00Z")}`);
    const snapshot = (quote, extra = {}) => JSON.stringify({ quote: { id: quote, status: "sent", payment_terms: "45 days", gst_percent: 18, grand_total: 240000, total_margin_amount: 52000, notes: "Old note", approved_by: f.owner, updated_at: "2026-09-20T08:00:00Z", ...extra }, items: snapshotItems });
    await db.query(`insert into quote_revisions(company_id,quote_id,revision_number,snapshot_json,revised_by,reason) values
      ($1,$2,1,$3,$4,'Customer asked for powder coating'),($1,$5,1,$6,$4,'Dealer revision'),($7,$8,1,$9,null,'FOREIGN')`,
      [f.company, f.quote, snapshot(f.quote), f.sales, f.dealerQuote, snapshot(f.dealerQuote), f.otherCompany, f.foreignQuote, snapshot(f.foreignQuote)]);
  }
  return { db, asUser, compare, reset, close: () => db.close() };
}

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const aid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const aids = {
  company: aid(1), otherCompany: aid(2), owner: aid(10), admin: aid(11), salesManager: aid(12), sales: aid(13), accounts: aid(14), viewer: aid(15), foreign: aid(16), dealer: aid(17),
  customer: aid(20), vendor: aid(21),
  lowMarginQuote: aid(30), normalQuote: aid(31), incompleteQuote: aid(32), draftQuote: aid(33), ownQuote: aid(34), foreignQuote: aid(35),
  smallExpense: aid(40), bigExpense: aid(41), draftExpense: aid(42), ownExpense: aid(43)
};

const M = "supabase/migrations/";
const INSTALL = [
  ["20261008010000_access_projection_integrity.sql", "private.guard_low_margin_quote_approval"],
  ["20260718051000_quote_status_transitions.sql", "private.enforce_quote_status_transition"],
  ["20261021190916_collaboration_procedure_routines.sql", "private.guard_quote_preparation_stage"],
  ["20260929000000_business_logic_fixes.sql", "private.require_complete_quote_costing"],
  ["20261020010000_expense_ledger_integrity.sql", "private.expense_approval_threshold"],
  ["20261020010000_expense_ledger_integrity.sql", "private.set_expense_approval_state"],
  ["20261020010000_expense_ledger_integrity.sql", "private.transition_expense_approval"],
  ["20261020010000_expense_ledger_integrity.sql", "public.apply_expense_approval_policy"]
];

// Quotes and expenses with their real approval guards installed from the latest migrations.
export async function createApprovalInboxFixture() {
  const db = new PGlite();
  const f = aids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function public.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select private.get_current_user_role()$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text);
    create table vendors(id uuid primary key,company_id uuid,vendor_name text);
    create table orders(id uuid primary key,company_id uuid,quote_id uuid);
    create table quotes(id uuid primary key,company_id uuid,quote_number text,customer_id uuid,status text,grand_total numeric,total_margin_amount numeric,low_margin_approval_required boolean default false,
      estimated_profit_percent numeric,revision_number integer default 1,notes text,approval_notes text,approved_by uuid,approved_at timestamptz,sent_at timestamptz,customer_decision_at timestamptz,
      created_by uuid,updated_at timestamptz default now(),deleted_at timestamptz);
    create table quote_items(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,costing_complete boolean,finishing_charge_type text,surface_area_sqft numeric);
    create table expense_ledger(id uuid primary key,company_id uuid,expense_number text,vendor_id uuid,vendor_name_snapshot text,expense_category text,description text,total_amount numeric,
      approval_status text,approved_by uuid,approved_at timestamptz,approval_note text,source_table text,amount_paid numeric default 0,credited_amount numeric default 0,refunded_amount numeric default 0,
      created_by uuid,updated_by uuid,updated_at timestamptz default now(),deleted_at timestamptz);
    create table audit_logs(id uuid primary key default gen_random_uuid(),company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata_json jsonb);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,notification_type text,severity text,title text,body text,related_entity_type text,
      related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,entity_reference text,created_at timestamptz default now());
    create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at := clock_timestamp(); return new; end$$;`);
  for (const [file, name] of INSTALL) await db.exec(extractSqlFunction(M + file, name));
  await db.exec(`create trigger a_guard_low_margin_quote_approval before update on quotes for each row execute function private.guard_low_margin_quote_approval();
    create trigger enforce_quote_status_transition before update on quotes for each row execute function private.enforce_quote_status_transition();
    create trigger quote_preparation_stage_guard before insert or update on quotes for each row execute function private.guard_quote_preparation_stage();
    create trigger zz_require_complete_quote_costing before update on quotes for each row execute function private.require_complete_quote_costing();
    create trigger set_quotes_updated_at before update on quotes for each row execute function public.set_updated_at();
    create trigger z_apply_expense_approval_policy before insert or update on expense_ledger for each row execute function public.apply_expense_approval_policy();
    create trigger set_expense_ledger_updated_at before update on expense_ledger for each row execute function public.set_updated_at();
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    grant select on all tables in schema public to authenticated;`);
  await db.exec(readFileSync(M + "20261022280000_approval_inbox.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.approval_inbox_command($1,$2) data", [name, payload], actor))[0].data;
  const inbox = async (actor = f.owner, payload = {}) => command("inbox.list", payload, actor);
  const item = async (sourceId, actor = f.owner) => (await inbox(actor)).rows.find((row) => row.source_id === sourceId);
  let next = 6000;
  /** Decides the current version of an inbox item, as the page does. */
  async function decide(sourceId, decision, note = null, actor = f.owner, version) {
    const row = await item(sourceId, actor);
    const v = version ?? row?.version;
    return command("inbox.decide", { source_type: row?.source_type ?? "quote", source_id: sourceId, version: v ?? "0".repeat(32), decision, note, request_id: aid(next++) }, actor);
  }

  async function reset() {
    await db.exec(`truncate approval_decisions,notifications,audit_logs,expense_ledger,quote_items,quotes,orders,vendors,customers,app_users,companies`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.admin}','${f.company}','admin',true,'Admin Dev',null),
        ('${f.salesManager}','${f.company}','sales_manager',true,'Sales Mgr Priya',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
        ('${f.accounts}','${f.company}','accounts',true,'Accounts Meena',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','sales_manager',true,'Dealer mgr','${aid(700)}');
      insert into customers values('${f.customer}','${f.company}','Kumar','Kumar Facades');
      insert into vendors values('${f.vendor}','${f.company}','Shree Powder Coaters');
      insert into quotes(id,company_id,quote_number,customer_id,status,grand_total,total_margin_amount,low_margin_approval_required,estimated_profit_percent,created_by,updated_at) values
        ('${f.lowMarginQuote}','${f.company}','QT-0001','${f.customer}','internal_review',118000,2000,true,1.7,'${f.sales}','2026-10-20T10:00:00Z'),
        ('${f.normalQuote}','${f.company}','QT-0002','${f.customer}','internal_review',59000,9000,false,15.3,'${f.sales}','2026-10-21T10:00:00Z'),
        ('${f.incompleteQuote}','${f.company}','QT-0003','${f.customer}','internal_review',1000,100,false,10,'${f.sales}','2026-10-21T11:00:00Z'),
        ('${f.draftQuote}','${f.company}','QT-0004','${f.customer}','draft',1000,100,false,10,'${f.sales}','2026-10-21T12:00:00Z'),
        ('${f.ownQuote}','${f.company}','QT-0005','${f.customer}','internal_review',2000,300,false,15,'${f.salesManager}','2026-10-21T13:00:00Z'),
        ('${f.foreignQuote}','${f.otherCompany}','FOREIGN-Q',null,'internal_review',1,1,false,1,null,'2026-10-19T10:00:00Z');
      insert into quote_items(company_id,quote_id,costing_complete) values('${f.company}','${f.lowMarginQuote}',true),('${f.company}','${f.normalQuote}',true),
        ('${f.company}','${f.incompleteQuote}',true),('${f.company}','${f.incompleteQuote}',false),('${f.company}','${f.ownQuote}',true);`);
    // Expenses enter through the real policy trigger as a privileged session, like the save action.
    await db.exec(`begin; select set_config('test.actor','${f.sales}',true);
      insert into expense_ledger(id,company_id,expense_number,vendor_id,expense_category,description,total_amount,approval_status,source_table,created_by,updated_at) values
        ('${f.smallExpense}','${f.company}','EXP-0001','${f.vendor}','maintenance','Puller belt replacement',18000,'pending_approval','breakdown_logs','${f.sales}','2026-10-21T09:00:00Z'),
        ('${f.bigExpense}','${f.company}','EXP-0002','${f.vendor}','die_purchase','New die for EX-205',145000,'pending_approval','dies','${f.sales}','2026-10-21T09:30:00Z'),
        ('${f.draftExpense}','${f.company}','EXP-0003','${f.vendor}','misc','Draft',500,'draft',null,'${f.sales}','2026-10-21T09:45:00Z'),
        ('${f.ownExpense}','${f.company}','EXP-0004','${f.vendor}','misc','Raised by accounts',30000,'pending_approval','manual','${f.accounts}','2026-10-21T09:50:00Z');
      commit;`);
  }
  return { db, asUser, command, inbox, item, decide, reset, close: () => db.close() };
}

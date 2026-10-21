import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const company = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const migration = readFileSync(new URL("../supabase/migrations/20261021290100_operation_page_null_projection.sql", import.meta.url), "utf8");
const prerequisite = readFileSync(new URL("../supabase/migrations/20261008050000_operation_search_integrity.sql", import.meta.url), "utf8");

test("database page omits masked financial keys while preserving authorized values, tenant scope, pagination and grants", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql as $$select '${company}'::uuid$$;
      create function public.get_current_user_company_id() returns uuid language sql as $$select '${company}'::uuid$$;
      create function public.get_current_user_role() returns text language sql as $$select nullif(current_setting('test.role', true), '')$$;
      create table customers(id uuid, company_id uuid, customer_name text, company_name text, gst_number text);
      create table orders(id uuid, company_id uuid, customer_id uuid, order_number text, order_value numeric, current_stage text, priority text, expected_dispatch_date date);
      create view orders_authorized as select id, company_id, customer_id, order_number,
        case when get_current_user_role() in ('owner','admin','accounts','sales','sales_manager') then order_value end as order_value,
        current_stage, priority, expected_dispatch_date from orders;
      create table quotes(id uuid, company_id uuid, customer_id uuid, quote_number text, grand_total numeric, estimated_profit_amount numeric, approval_notes text, quote_date date);
      create view quotes_authorized as select id, company_id, customer_id, quote_number,
        case when get_current_user_role() in ('owner','admin','accounts','sales','sales_manager') then grand_total end as grand_total,
        case when get_current_user_role() in ('owner','admin','accounts') then estimated_profit_amount end as estimated_profit_amount,
        case when get_current_user_role() in ('owner','admin','accounts') then approval_notes end as approval_notes, quote_date from quotes;
      insert into customers values ('${company}', '${company}', 'Local customer', null, null), ('${foreign}', '${foreign}', 'Foreign sentinel', null, null);
      insert into orders select gen_random_uuid(), '${company}', '${company}', 'ORD-' || lpad(n::text, 3, '0'), 900+n, 'order_confirmed', 'normal', '2026-10-21' from generate_series(1, 23) n;
      insert into orders values ('${foreign}', '${foreign}', '${foreign}', 'FOREIGN', 987654321, 'order_confirmed', 'normal', '2026-10-21');
      insert into quotes values ('${company}', '${company}', '${company}', 'QUO-001', 1500, 275, 'Private approval', '2026-10-21');
      grant usage on schema public, auth to authenticated;
      grant select on all tables in schema public to authenticated;
    `);
    await db.exec(prerequisite);
    const before = (await db.query("select proacl::text as acl, proconfig from pg_proc where oid='public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date)'::regprocedure")).rows[0];
    await db.exec(migration);
    await db.exec(migration);
    const after = (await db.query("select proacl::text as acl, proconfig, prosecdef from pg_proc where oid='public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date)'::regprocedure")).rows[0];
    assert.equal(after.prosecdef, false);
    assert.deepEqual(after.proconfig, before.proconfig);
    assert.equal(after.acl, before.acl);
    await db.exec("set role authenticated; set test.role='dispatch';");
    const page = async (module, pageNumber = 1) => (await db.query("select public.get_operation_database_page($1,'','{}'::jsonb,$2,'asc',$3) as value", [module, module === "orders" ? "order_number" : "quote_number", pageNumber])).rows[0].value;
    const first = await page("orders");
    const last = await page("orders", 3);
    assert.equal(first.count, 23);
    assert.equal(first.rows.length, 10);
    assert.equal(last.rows.length, 3);
    assert.ok(first.rows.every(row => row.company_id === company && !Object.hasOwn(row, "order_value")));
    assert.ok(first.rows.every(row => row.customers.customer_name === "Local customer" && !Object.hasOwn(row.customers, "company_name")));
    assert.ok(last.rows.every(row => !first.rows.some(item => item.id === row.id)));
    await assert.rejects(page("quotes"), /Permission denied/);
    await db.exec("set test.role='viewer';");
    const viewerQuote = (await page("quotes")).rows[0];
    assert.equal(Object.hasOwn(viewerQuote, "grand_total"), false);
    assert.equal(Object.hasOwn(viewerQuote, "estimated_profit_amount"), false);
    assert.equal(Object.hasOwn(viewerQuote, "approval_notes"), false);
    await db.exec("set test.role='sales';");
    const salesQuote = (await page("quotes")).rows[0];
    assert.equal(salesQuote.grand_total, 1500);
    assert.equal(Object.hasOwn(salesQuote, "estimated_profit_amount"), false);
    await db.exec("set test.role='accounts';");
    assert.equal((await page("orders")).rows[0].order_value, 901);
    assert.equal((await page("quotes")).rows[0].estimated_profit_amount, 275);
    assert.equal((await page("quotes")).rows[0].approval_notes, "Private approval");
    await assert.rejects(db.query("select public.get_operation_database_page('orders','','{}','company_id;drop table orders')"), /Unsupported sort/);
    await db.exec("reset role; set role anon;");
    await assert.rejects(page("orders"), /permission denied/);
  } finally { await db.close(); }
});

test("projection migration fails closed when prerequisites drift", async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(migration), /prerequisite is missing/);
    await db.exec("rollback;");
    await db.exec("create function public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date) returns jsonb language sql as $$select '{}'::jsonb$$;");
    await assert.rejects(db.exec(migration), /projection has changed/);
    await db.exec("rollback; drop function public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date);");
    await db.exec("create function public.get_operation_database_page(text,text,jsonb,text,text,integer,date,date) returns jsonb language sql security definer as $$select '{}'::jsonb$$;");
    await assert.rejects(db.exec(migration), /must remain SECURITY INVOKER/);
  } finally { await db.close(); }
});

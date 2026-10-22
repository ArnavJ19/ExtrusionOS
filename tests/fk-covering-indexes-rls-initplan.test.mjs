import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20261022010000_fk_covering_indexes_and_rls_initplan.sql", import.meta.url), "utf8");
const companyA = "11111111-1111-4111-8111-111111111111";
const companyB = "22222222-2222-4222-8222-222222222222";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.companies(id uuid primary key, created_by uuid);
    create table public.app_users(id uuid primary key, company_id uuid references public.companies(id), role text);
    create function public.get_current_user_company_id() returns uuid language sql stable as $$ select company_id from public.app_users where id = auth.uid() $$;
    create table public.orders(id uuid primary key, company_id uuid not null references public.companies(id), created_by uuid references public.app_users(id), note text);
    create index orders_company_idx on public.orders(company_id, id);
    alter table public.orders add constraint orders_id_company_key unique (id, company_id);
    create table public.order_lines(id uuid primary key, company_id uuid not null, order_id uuid not null, profile text,
      foreign key (company_id) references public.companies(id), constraint order_lines_parent_fk foreign key (order_id, company_id) references public.orders(id, company_id) deferrable);
    create table private.requests(id uuid primary key, order_id uuid references public.orders(id));
    create table public.partial_idx(id uuid primary key, order_id uuid references public.orders(id));
    create index partial_idx_order_partial on public.partial_idx(order_id) where order_id is not null;
    alter table public.orders enable row level security;
    alter table public.app_users enable row level security;
    create policy orders_read on public.orders for select to authenticated using ((auth.uid() is not null) and company_id = get_current_user_company_id());
    create policy orders_insert on public.orders for insert to authenticated with check (created_by = auth.uid() and company_id = get_current_user_company_id());
    create policy orders_update on public.orders for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid() and company_id = (select app_users.company_id from app_users where app_users.id = auth.uid()));
    create policy already_wrapped on public.app_users for select to authenticated using (id = (select auth.uid()));
    create policy restrictive_guard on public.orders as restrictive for all to authenticated using (note is distinct from 'hidden') with check (note is distinct from 'hidden');
    grant usage on schema public, auth to authenticated;
    grant select, insert, update on public.orders to authenticated;
    grant select on public.app_users to authenticated;
    insert into public.companies values ('${companyA}', null), ('${companyB}', null);
    insert into public.app_users values ('${userA}', '${companyA}', 'sales'), ('${userB}', '${companyB}', 'sales');
    insert into public.orders values (gen_random_uuid(), '${companyA}', '${userA}', 'a1'), (gen_random_uuid(), '${companyA}', '${userA}', 'hidden'), (gen_random_uuid(), '${companyB}', '${userB}', 'b1');
  `);
  return db;
}

const policies = async (db) => (await db.query(`
  select c.relname, p.polname, p.polcmd, p.polpermissive, p.polroles::text as roles,
    pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as with_check
  from pg_policy p join pg_class c on c.oid = p.polrelid order by 1, 2`)).rows;

const visibleAs = async (db, uid) => {
  await db.exec(`set role authenticated; set test.uid = '${uid}';`);
  try {
    return (await db.query("select note from public.orders order by note")).rows.map((row) => row.note);
  } finally {
    await db.exec("reset role;");
  }
};

test("covering indexes are added for every unindexed foreign key, once", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const indexes = (await db.query(`select schemaname, tablename, indexname, indexdef from pg_indexes where indexname like '%fk_idx' order by 1, 2, 3`)).rows;
    const names = indexes.map((row) => `${row.schemaname}.${row.indexname}`);
    assert.deepEqual(names, [
      "private.requests_order_id_fk_idx",
      "public.app_users_company_id_fk_idx",
      "public.order_lines_company_id_fk_idx",
      "public.order_lines_order_id_company_id_fk_idx",
      "public.orders_created_by_fk_idx",
      "public.partial_idx_order_id_fk_idx",
    ]);
    assert.match(indexes.find((row) => row.indexname === "order_lines_order_id_company_id_fk_idx").indexdef, /\(order_id, company_id\)/);
    // orders.company_id was already covered by orders_company_idx.
    assert.equal(names.includes("public.orders_company_id_fk_idx"), false);
    const before = (await db.query("select count(*)::int as n from pg_indexes")).rows[0].n;
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::int as n from pg_indexes")).rows[0].n, before);
  } finally {
    await db.close();
  }
});

test("policies evaluate auth.uid() once per statement with unchanged meaning", async () => {
  const db = await fixture();
  try {
    const before = await policies(db);
    const visibleBefore = [await visibleAs(db, userA), await visibleAs(db, userB), await visibleAs(db, "")];
    await db.exec(migration);
    const after = await policies(db);
    assert.equal(after.length, before.length);
    for (const [index, policy] of after.entries()) {
      const original = before[index];
      assert.deepEqual(
        [policy.relname, policy.polname, policy.polcmd, policy.polpermissive, policy.roles],
        [original.relname, original.polname, original.polcmd, original.polpermissive, original.roles],
      );
      for (const field of ["qual", "with_check"]) {
        if (original[field] === null) { assert.equal(policy[field], null); continue; }
        assert.doesNotMatch(policy[field].replaceAll("( SELECT auth.uid() AS uid)", ""), /auth\.uid\(\)/, `${policy.polname}.${field}`);
        assert.equal(policy[field].replaceAll("( SELECT auth.uid() AS uid)", "auth.uid()"), original[field].replaceAll("( SELECT auth.uid() AS uid)", "auth.uid()"));
      }
    }
    assert.equal(after.find((row) => row.polname === "already_wrapped").qual, before.find((row) => row.polname === "already_wrapped").qual);
    assert.equal(after.find((row) => row.polname === "restrictive_guard").qual, before.find((row) => row.polname === "restrictive_guard").qual);
    const visibleAfter = [await visibleAs(db, userA), await visibleAs(db, userB), await visibleAs(db, "")];
    assert.deepEqual(visibleAfter, visibleBefore);
    assert.deepEqual(visibleAfter, [["a1"], ["b1"], []]);

    await db.exec(`set role authenticated; set test.uid = '${userA}';`);
    await db.exec(`insert into public.orders values (gen_random_uuid(), '${companyA}', '${userA}', 'a2')`);
    await assert.rejects(db.exec(`insert into public.orders values (gen_random_uuid(), '${companyB}', '${userA}', 'cross')`), /row-level security/);
    await assert.rejects(db.exec(`insert into public.orders values (gen_random_uuid(), '${companyA}', '${userB}', 'forged')`), /row-level security/);
    await db.exec("reset role;");

    const snapshot = await policies(db);
    await db.exec(migration);
    assert.deepEqual(await policies(db), snapshot);
  } finally {
    await db.close();
  }
});

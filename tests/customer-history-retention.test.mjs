import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const migration = readFileSync(new URL("20261022140000_customer_history_retention.sql", migrationDirectory), "utf8");
const historyTables = ["portal_users", "quote_requests", "support_tickets", "customer_compliance_requirements"];
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const primary = { company: id(1), customer: id(10), actor: id(100), offset: 0 };
const sibling = { company: id(2), customer: id(12), actor: id(101), offset: 1 };
const unlinkedCustomer = id(11);

function tableDefinition(file, table) {
  const source = readFileSync(new URL(file, migrationDirectory), "utf8").replaceAll("\r\n", "\n");
  const match = source.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`, "i"));
  assert.ok(match, `Expected the original ${table} table definition in ${file}`);
  return match[0];
}

async function createFixture() {
  const database = new PGlite();
  await database.exec(`
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.companies(id uuid primary key);
    create table public.customers(
      id uuid primary key,
      company_id uuid not null references public.companies(id) on delete cascade,
      is_active boolean not null default true
    );
    create table public.orders(id uuid primary key);
    insert into public.companies values ('${primary.company}'), ('${sibling.company}');
    insert into auth.users values ('${primary.actor}'), ('${sibling.actor}');
    insert into public.customers(id, company_id) values
      ('${primary.customer}', '${primary.company}'),
      ('${unlinkedCustomer}', '${primary.company}'),
      ('${sibling.customer}', '${sibling.company}');
  `);
  for (const table of historyTables) {
    const file = table === "customer_compliance_requirements"
      ? "20260608000000_pcda_crm_enrichment.sql"
      : "20260515000900_enterprise_phase_4.sql";
    await database.exec(tableDefinition(file, table));
  }
  return database;
}

async function insertHistory(database, table, scope = primary) {
  const { company, customer, actor, offset } = scope;
  if (table === "portal_users") {
    return database.query(`insert into public.portal_users(id, company_id, customer_id, email, full_name)
      values ($1, $2, $3, $4, 'Customer contact')`, [actor, company, customer, `contact-${offset}@example.test`]);
  }
  if (table === "quote_requests") {
    return database.query(`insert into public.quote_requests(id, company_id, customer_id, request_number, request_type)
      values ($1, $2, $3, $4, 'standard_order')`, [id(200 + offset), company, customer, `REQ-${offset}`]);
  }
  if (table === "support_tickets") {
    return database.query(`insert into public.support_tickets(id, company_id, customer_id, ticket_number, issue_type, description)
      values ($1, $2, $3, $4, 'delivery_delay', 'Retain the original support record')`,
    [id(300 + offset), company, customer, `TICKET-${offset}`]);
  }
  assert.equal(table, "customer_compliance_requirements");
  return database.query(`insert into public.customer_compliance_requirements(id, company_id, customer_id, certificate_type)
    values ($1, $2, $3, 'material_test_certificate')`, [id(400 + offset), company, customer]);
}

async function insertAllHistory(database, scope = primary) {
  for (const table of historyTables) await insertHistory(database, table, scope);
  for (const table of ["quote_requests", "support_tickets"]) {
    await database.query(`update public.${table} set portal_user_id = $1 where customer_id = $2`, [scope.actor, scope.customer]);
  }
}

async function snapshot(database) {
  const result = {};
  for (const table of ["customers", ...historyTables]) {
    result[table] = (await database.query(`select * from public.${table} order by id`)).rows;
  }
  return result;
}

let db;
test.before(async () => {
  db = await createFixture();
  await db.exec(migration);
});
test.after(async () => { if (db) await db.close(); });
test.beforeEach(async () => { await db.exec("begin;"); });
test.afterEach(async () => { await db.exec("rollback;"); });

async function attempt(callback) {
  await db.exec("savepoint customer_delete_attempt;");
  try {
    const result = await callback();
    await db.exec("release savepoint customer_delete_attempt;");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint customer_delete_attempt; release savepoint customer_delete_attempt;");
    throw error;
  }
}

test("the original customer foreign keys silently erase all four kinds of history", async () => {
  const original = await createFixture();
  try {
    await insertAllHistory(original);
    await original.query("delete from public.customers where id = $1", [primary.customer]);
    const after = await snapshot(original);
    assert.ok(!after.customers.some((row) => row.id === primary.customer));
    for (const table of historyTables) assert.deepEqual(after[table], [], table);
  } finally { await original.close(); }
});

test("every repaired customer foreign key is validated and uses statement-end NO ACTION", async () => {
  const { rows } = await db.query(`select conrelid::regclass::text as table_name, confdeltype, convalidated, condeferrable
    from pg_constraint where contype = 'f' and confrelid = 'public.customers'::regclass order by table_name`);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.table_name).sort(), [...historyTables].sort());
  for (const row of rows) {
    assert.equal(row.confdeltype, "a", row.table_name);
    assert.equal(row.convalidated, true, row.table_name);
    assert.equal(row.condeferrable, false, row.table_name);
  }
});

for (const table of historyTables) {
  test(`customer deletion with only ${table} is rejected and preserves both records`, async () => {
    await insertHistory(db, table);
    const before = await snapshot(db);
    await assert.rejects(attempt(() => db.query("delete from public.customers where id = $1", [primary.customer])),
      (error) => error.code === "23503");
    assert.deepEqual(await snapshot(db), before);
  });
}

test("a customer with linked portal, quote, support and compliance records retains all history", async () => {
  await insertAllHistory(db);
  const before = await snapshot(db);
  await assert.rejects(attempt(() => db.query("delete from public.customers where id = $1", [primary.customer])),
    (error) => error.code === "23503");
  assert.deepEqual(await snapshot(db), before);
});

test("a bulk customer delete rolls back deletion of an unlinked customer as well", async () => {
  await insertAllHistory(db);
  const before = await snapshot(db);
  await assert.rejects(attempt(() => db.query("delete from public.customers where id in ($1, $2)",
    [primary.customer, unlinkedCustomer])), (error) => error.code === "23503");
  assert.deepEqual(await snapshot(db), before);
});

test("deactivating a referenced customer succeeds without removing its history", async () => {
  await insertAllHistory(db);
  const before = await snapshot(db);
  await db.query("update public.customers set is_active = false where id = $1", [primary.customer]);
  const after = await snapshot(db);
  assert.equal(after.customers.find((row) => row.id === primary.customer).is_active, false);
  for (const table of historyTables) assert.deepEqual(after[table], before[table], table);
});

test("an unreferenced customer can still be deleted", async () => {
  const { rows } = await db.query("delete from public.customers where id = $1 returning id", [unlinkedCustomer]);
  assert.deepEqual(rows, [{ id: unlinkedCustomer }]);
  assert.equal((await db.query("select id from public.customers where id = $1", [primary.customer])).rows.length, 1);
});

test("all four tables still reject a missing customer on insert", async () => {
  for (const table of historyTables) {
    await assert.rejects(attempt(() => insertHistory(db, table, { ...primary, customer: id(999) })),
      (error) => error.code === "23503", table);
  }
});

test("history cannot be reassigned to a nonexistent customer", async () => {
  await insertAllHistory(db);
  const before = await snapshot(db);
  for (const table of historyTables) {
    await assert.rejects(attempt(() => db.query(`update public.${table} set customer_id = $1`, [id(999)])),
      (error) => error.code === "23503", table);
  }
  assert.deepEqual(await snapshot(db), before);
});

test("the affected company cascades still work without deleting a sibling company's history", async () => {
  await insertAllHistory(db);
  await insertAllHistory(db, sibling);
  const before = await snapshot(db);
  await db.query("delete from public.companies where id = $1", [primary.company]);
  const after = await snapshot(db);
  for (const table of ["customers", ...historyTables]) {
    assert.deepEqual(after[table], before[table].filter((row) => row.company_id === sibling.company), table);
  }
  assert.deepEqual((await db.query("select id from auth.users order by id")).rows,
    [{ id: primary.actor }, { id: sibling.actor }]);
});

test("the migration preserves existing history and is safe to replay", async () => {
  const existing = await createFixture();
  try {
    await insertAllHistory(existing);
    const before = await snapshot(existing);
    await existing.exec(migration);
    assert.deepEqual(await snapshot(existing), before);
    await existing.exec(migration);
    assert.deepEqual(await snapshot(existing), before);
  } finally { await existing.close(); }
});

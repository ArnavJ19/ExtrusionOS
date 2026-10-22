import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const company = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const customer = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const foreignCustomer = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const candidate = "20261020120000_invoice_supplier_snapshot_contact.sql";
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const legacyKeys = ["billing_address", "gst_number", "legal_name", "name"];
const contactKeys = ["city", "email", "phone", "pincode", "state"];
let db;

async function rejects(text, pattern) {
  await assert.rejects(db.exec(text), pattern);
}
const invoice = async (number) => (await db.query("select * from invoices where invoice_number=$1", [number])).rows[0];

test.before(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema private;
    create table companies(id uuid primary key, name text not null, legal_name text, gst_number text, phone text, email text,
      billing_address text, city text, state text, pincode text);
    create table customers(id uuid primary key, company_id uuid, customer_name text, company_name text, gst_number text,
      billing_address text, shipping_address text);
    create table invoices(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, invoice_number text, status text);
    insert into companies values
      ('${company}','Shree Extrusions','Shree Extrusions Pvt Ltd','24ABCDE1234F1Z5','+91 98250 00000','accounts@shree.example',
        'Plot 12, GIDC Phase II','Ahmedabad','Gujarat','382445'),
      ('${foreign}','Other Alu','Other Alu LLP','27ZZZZZ9999Z1Z9','+91 90000 00000','other@alu.example','Unit 4','Pune','Maharashtra','411019');
    insert into customers values
      ('${customer}','${company}','Ramesh','Patel Fabricators','24PQRST5678K1Z2','Shop 3, Naroda','Site 7, SG Highway'),
      ('${foreignCustomer}','${foreign}','Other','Other Fabricators',null,'Elsewhere',null);
  `);
  // Install the trigger exactly as the current baseline migration defines it.
  const astra = migration("20260930000000_astra_audit_fixes.sql");
  const block = astra.match(/alter table public\.invoices add column if not exists supplier_snapshot[\s\S]*?create trigger zzzz_snapshot_invoice_parties[^;]+;/);
  assert.ok(block, "baseline snapshot trigger block not found");
  await db.exec(block[0]);
  await db.exec(`insert into invoices(company_id, customer_id, invoice_number, status) values ('${company}','${customer}','INV-LEGACY','issued');`);
  await db.exec(migration(candidate));
});

test.after(async () => { await db?.close(); });

test("the candidate is the newest definition of the snapshot trigger function", async () => {
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((file) => file.endsWith(".sql")).sort();
  const definers = files.filter((file) => /create or replace function private\.snapshot_invoice_parties\(/.test(migration(file)));
  assert.equal(definers.at(-1), candidate);
});

test("a new invoice's supplier snapshot carries city, state, PIN, phone and e-mail plus every existing key", async () => {
  await db.exec(`insert into invoices(company_id, customer_id, invoice_number, status) values ('${company}','${customer}','INV-NEW','draft');`);
  const row = await invoice("INV-NEW");
  assert.deepEqual(Object.keys(row.supplier_snapshot).sort(), [...legacyKeys, ...contactKeys].sort());
  assert.deepEqual(row.supplier_snapshot, {
    name: "Shree Extrusions", legal_name: "Shree Extrusions Pvt Ltd", gst_number: "24ABCDE1234F1Z5",
    billing_address: "Plot 12, GIDC Phase II", city: "Ahmedabad", state: "Gujarat", pincode: "382445",
    phone: "+91 98250 00000", email: "accounts@shree.example",
  });
  assert.deepEqual(row.customer_snapshot, {
    customer_name: "Ramesh", company_name: "Patel Fabricators", gst_number: "24PQRST5678K1Z2",
    billing_address: "Shop 3, Naroda", shipping_address: "Site 7, SG Highway",
  });
});

test("snapshots are frozen at insert: later company edits do not reach an issued invoice", async () => {
  await db.exec(`update companies set city='Vadodara', phone='+91 99999 11111' where id='${company}';`);
  const row = await invoice("INV-NEW");
  assert.equal(row.supplier_snapshot.city, "Ahmedabad");
  assert.equal(row.supplier_snapshot.phone, "+91 98250 00000");
  await db.exec(`update companies set city='Ahmedabad', phone='+91 98250 00000' where id='${company}';`);
});

test("existing invoices are not backfilled and keep their original snapshot", async () => {
  const row = await invoice("INV-LEGACY");
  assert.deepEqual(Object.keys(row.supplier_snapshot).sort(), legacyKeys);
});

test("existing and new snapshots and party identities remain immutable", async () => {
  for (const number of ["INV-LEGACY", "INV-NEW"]) {
    await rejects(`update invoices set supplier_snapshot = supplier_snapshot || '{"city":"Surat"}' where invoice_number='${number}';`, /immutable/);
    await rejects(`update invoices set supplier_snapshot = null where invoice_number='${number}';`, /immutable/);
    await rejects(`update invoices set customer_snapshot = '{}' where invoice_number='${number}';`, /immutable/);
    await rejects(`update invoices set company_id='${foreign}' where invoice_number='${number}';`, /immutable/);
    await rejects(`update invoices set customer_id='${foreignCustomer}' where invoice_number='${number}';`, /immutable/);
  }
  // Ordinary non-party updates still pass.
  await db.exec(`update invoices set status='issued' where invoice_number='INV-NEW';`);
  assert.equal((await invoice("INV-NEW")).status, "issued");
});

test("client-supplied snapshots are overwritten and cross-company parties are still rejected", async () => {
  await db.exec(`insert into invoices(company_id, customer_id, invoice_number, status, supplier_snapshot)
    values ('${company}','${customer}','INV-FORGED','draft','{"name":"Forged","city":"Nowhere"}');`);
  const row = await invoice("INV-FORGED");
  assert.equal(row.supplier_snapshot.name, "Shree Extrusions");
  assert.equal(row.supplier_snapshot.city, "Ahmedabad");
  await rejects(`insert into invoices(company_id, customer_id, invoice_number) values ('${company}','${foreignCustomer}','INV-X');`,
    /must belong to the authenticated company/);
  await rejects(`insert into invoices(company_id, customer_id, invoice_number) values ('99999999-9999-4999-8999-999999999999','${customer}','INV-Y');`,
    /must belong to the authenticated company/);
});

test("the function stays security definer with a pinned search path and no client execute grant", async () => {
  const { rows } = await db.query(`select p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec,
      obj_description(p.oid, 'pg_proc') as note
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='snapshot_invoice_parties'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prosecdef, true);
  assert.deepEqual(rows[0].proconfig, ["search_path=public, private"]);
  assert.equal(rows[0].auth_exec, false);
  assert.equal(rows[0].anon_exec, false);
  assert.match(rows[0].note, /not backfilled/);
  assert.match(migration(candidate), /new invoices only/i);
  assert.doesNotMatch(migration(candidate), /\bupdate\s+public\.invoices\b|\bdrop\b|disable row level security/i);
});

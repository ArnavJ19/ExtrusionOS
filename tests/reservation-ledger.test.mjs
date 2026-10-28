import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";
import { getReservationLedgerOptions, loadReservationLedgerPage } from "../lib/inventory/reservation-ledger.ts";
import { can } from "../lib/auth/permissions.ts";
import { installDispatchReservationLedgerObjects } from "../scripts/lib/dispatch-reservation-ledger-fixture.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), sibling = id(2), actor = id(10), siblingActor = id(11);
const file = "20261015010000_reservation_ledger_projection.sql";
const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
let db;
const client = { async rpc(name, args) {
  assert.equal(name, "get_profile_stock_reservation_ledger_page");
  try {
    const result = await db.query("select public.get_profile_stock_reservation_ledger_page($1,$2,$3,$4,$5) data",
      [args.p_page, args.p_search, args.p_status, args.p_sort, args.p_direction]);
    return { data: result.rows[0].data, error: null };
  } catch (error) {
    return { data: null, error };
  }
} };
const load = params => loadReservationLedgerPage(client, getReservationLedgerOptions(params ?? {}));

test.before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean);
    create function private.get_current_user_company_id() returns uuid language sql security definer as
      $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer as
      $$select role from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text,internal_notes text);
    create table orders(id uuid primary key,company_id uuid,customer_id uuid,order_number text,order_value numeric);
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text,profile_name text,internal_cost numeric);
    create table profile_stock_batches(id uuid primary key,company_id uuid,profile_id uuid,bundle_number text,location text,supplier_rate numeric);
    create table profile_stock_reservations(id uuid primary key,company_id uuid,profile_id uuid,order_id uuid,
      profile_stock_batch_id uuid,status text,created_at timestamptz,released_at timestamptz,notes text,
      reserved_weight_kg numeric(14,3),reserved_length_m numeric(14,3),reserved_pieces integer,
      initial_reserved_weight_kg numeric(14,3),initial_reserved_length_m numeric(14,3),initial_reserved_pieces integer);
    create table profile_stock_consumptions(id uuid primary key default gen_random_uuid(),company_id uuid,
      reservation_id uuid,order_id uuid,profile_id uuid,profile_stock_batch_id uuid,
      consumed_weight_kg numeric(14,3),consumed_length_m numeric(14,3),consumed_pieces integer);
    insert into app_users values('${actor}','${company}','owner',true),('${siblingActor}','${sibling}','owner',true);
    insert into customers values('${id(20)}','${company}','Customer A','Customer A','SECRET INTERNAL'),
      ('${id(21)}','${sibling}','SIBLING SECRET CUSTOMER','SIBLING SECRET CUSTOMER','SECRET INTERNAL');
    insert into aluminium_profiles values('${id(30)}','${company}','P-A','Profile A',99999),
      ('${id(31)}','${sibling}','SIBLING SECRET PROFILE','SIBLING SECRET PROFILE',99999);
    insert into profile_stock_batches values('${id(40)}','${company}','${id(30)}','B-A','Rack A',99999),
      ('${id(41)}','${sibling}','${id(31)}','SIBLING SECRET BUNDLE','SIBLING SECRET LOCATION',99999);`);
  const orders = Array.from({ length: 601 }, (_, n) => ({ id: id(2000 + n), company_id: company,
    customer_id: id(20), order_number: `ORD-${String(n).padStart(4, "0")}`, order_value: 99999 }));
  await db.query(`insert into orders select * from jsonb_to_recordset($1::jsonb)
    as x(id uuid,company_id uuid,customer_id uuid,order_number text,order_value numeric)`, [JSON.stringify(orders)]);
  const rows = Array.from({ length: 601 }, (_, n) => ({ id: id(1000 + n), company_id: company,
    profile_id: id(30), order_id: id(2000 + n), profile_stock_batch_id: id(40),
    status: ["active", "released", "consumed", "cancelled"][n % 4],
    created_at: "2026-10-15T00:00:00Z", released_at: n % 4 ? "2026-10-15T01:00:00Z" : null,
    notes: n === 0 ? "Literal %_ [A]" : n === 550 ? "Record beyond first 300" : null,
    reserved_weight_kg: n === 0 ? 2000 : 10, reserved_length_m: n === 0 ? 1000 : 5,
    reserved_pieces: n === 0 ? 2000 : 1 }));
  await db.query(`insert into profile_stock_reservations(id,company_id,profile_id,order_id,profile_stock_batch_id,
    status,created_at,released_at,notes,reserved_weight_kg,reserved_length_m,reserved_pieces)
    select * from jsonb_to_recordset($1::jsonb) as x(id uuid,company_id uuid,profile_id uuid,order_id uuid,
      profile_stock_batch_id uuid,status text,created_at timestamptz,released_at timestamptz,notes text,
      reserved_weight_kg numeric,reserved_length_m numeric,reserved_pieces integer)`, [JSON.stringify(rows)]);
  await db.exec(`insert into profile_stock_consumptions(company_id,reservation_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      select '${company}','${id(1000)}',1,0.5,1 from generate_series(1,1501);
    insert into profile_stock_consumptions(company_id,reservation_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      select company_id,id,10,5,1 from profile_stock_reservations where status='consumed';
    insert into orders values('${id(3000)}','${sibling}','${id(21)}','SIBLING SECRET ORDER',99999);
    insert into profile_stock_reservations(id,company_id,profile_id,order_id,profile_stock_batch_id,
      status,created_at,reserved_weight_kg,reserved_length_m,reserved_pieces)
      values('${id(4000)}','${sibling}','${id(31)}','${id(3000)}','${id(41)}','active',now(),10,5,1);
    insert into profile_stock_consumptions(company_id,reservation_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      values('${sibling}','${id(1000)}',99999,99999,99999);
    update profile_stock_consumptions c set order_id=r.order_id,profile_id=r.profile_id,
      profile_stock_batch_id=r.profile_stock_batch_id from profile_stock_reservations r
      where c.reservation_id=r.id and c.company_id=r.company_id;`);
  // Only the prepared read function and its explicit ACL are installed; no migration script is applied.
  const originalIndexes = readFileSync(new URL("../supabase/migrations/20260515003201_profile_stock_consumptions.sql", import.meta.url), "utf8");
  const index = originalIndexes.match(/create index if not exists profile_stock_consumptions_reservation_idx[^;]+;/);
  assert.ok(index);
  await db.exec(index[0]);
  await db.exec("analyze;");
  await db.exec(sqlDefinition(file, "public.get_profile_stock_reservation_ledger_page"));
  for (const statement of migration.match(/(?:revoke|grant)[^;]+;/g) ?? []) await db.exec(statement);
  await installDispatchReservationLedgerObjects(db);
});
test.after(async () => { if (db) await db.close(); });
test.beforeEach(async () => {
  await db.exec("reset role;");
  await db.query("update app_users set role='owner',is_active=true where id=$1", [actor]);
  await db.query("select set_config('test.actor',$1,false)", [actor]);
  await db.exec("set role authenticated;");
});

test("one bounded JSON result includes complete histories and summaries over all 601 matching rows", async () => {
  const result = await load();
  assert.equal(result.total_count, 601);
  assert.equal(result.rows.length, 10);
  assert.deepEqual(result.summary, { active_count: 151, open_weight_kg: 1999, consumed_weight_kg: 3001, released_weight_kg: 3000 });
  assert.deepEqual(Object.fromEntries(["consumed_weight_kg", "consumed_length_m", "consumed_pieces", "open_weight_kg", "open_length_m", "open_pieces"]
    .map(key => [key, result.rows[0][key]])), { consumed_weight_kg: 1501, consumed_length_m: 750.5,
    consumed_pieces: 1501, open_weight_kg: 499, open_length_m: 249.5, open_pieces: 499 });
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /SECRET|99999|order_value|internal_cost|supplier_rate|company_id/);
});

test("stable pages reach every row beyond the old 300-row cap with no gaps or duplicates", async () => {
  const ids = [];
  const expectedSummary = (await load()).summary;
  for (let page = 1; page <= 61; page++) {
    const result = await load({ page: String(page) });
    assert.equal(result.page, page);
    assert.deepEqual(result.summary, expectedSummary);
    ids.push(...result.rows.map(row => row.id));
  }
  assert.equal(ids.length, 601);
  assert.equal(new Set(ids).size, 601);
  assert.deepEqual(ids, Array.from({ length: 601 }, (_, n) => id(1000 + n)));
  assert.equal((await load({ page: "100000" })).page, 61);
});

test("literal search and status filters share the exact count, rows and quantities", async () => {
  for (const q of ["%", "_", "%_", "literal %_ [a]"]) {
    const result = await load({ q });
    assert.equal(result.total_count, 1);
    assert.equal(result.rows[0].id, id(1000));
    assert.equal(result.summary.open_weight_kg, 499);
  }
  assert.equal((await load({ q: "Record beyond first 300" })).rows[0].id, id(1550));
  const released = await load({ status: "released" });
  assert.equal(released.total_count, 150);
  assert.deepEqual(released.summary, { active_count: 0, open_weight_kg: 0, consumed_weight_kg: 0, released_weight_kg: 1500 });
  assert.ok(released.rows.every(row => row.status === "released" && row.open_weight_kg === 0 && row.released_weight_kg === 10));
  const empty = await load({ q: "no such reservation" });
  assert.equal(empty.total_count, 0);
  assert.deepEqual(empty.rows, []);
});

test("sort choices and direction are applied before range with a stable identity tie-break", async () => {
  const descending = await load({ sort: "reserved_weight_kg", direction: "desc" });
  assert.equal(descending.rows[0].id, id(1000));
  const ascending = await load({ sort: "reserved_weight_kg", direction: "asc" });
  assert.equal(ascending.rows[0].id, id(1001));
  assert.equal(ascending.rows[9].id, id(1010));
  for (const sort of ["status", "released_at"]) assert.equal((await load({ sort })).rows.length, 10);
});

test("business roles, suspended identities and SQL execute privileges retain the existing reservation read boundary", async () => {
  for (const role of ["owner", "admin", "production_manager", "production", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch",
    "viewer", "sales", "sales_manager", "accounts", "quality", "dealer_admin", "dealer_staff"]) {
    await db.exec("reset role;");
    await db.query("update app_users set role=$1 where id=$2", [role, actor]);
    await db.exec("set role authenticated;");
    if (can(role, "read", "inventory_reservations")) assert.equal((await load()).total_count, 601, role);
    else await assert.rejects(load(), /Permission denied/, role);
  }
  await db.exec("reset role;");
  await db.query("update app_users set is_active=false where id=$1", [actor]);
  await db.exec("set role authenticated;");
  await assert.rejects(load(), /Authentication required/);
  const privileges = (await db.query(`select has_function_privilege('authenticated','public.get_profile_stock_reservation_ledger_page(integer,text,text,text,text)','EXECUTE') authenticated,
    has_function_privilege('anon','public.get_profile_stock_reservation_ledger_page(integer,text,text,text,text)','EXECUTE') anonymous`)).rows[0];
  assert.deepEqual(privileges, { authenticated: true, anonymous: false });
});

test("another company sees only its own rows and foreign relationship labels cannot leak through an invalid source", async () => {
  await db.query("select set_config('test.actor',$1,false)", [siblingActor]);
  const other = await load();
  assert.equal(other.total_count, 1);
  assert.equal(other.rows[0].id, id(4000));
  assert.equal((await load({ q: "ORD-0000" })).total_count, 0);
  await db.exec("reset role;begin;");
  try {
    await db.query("select set_config('test.actor',$1,false)", [actor]);
    await db.query("update profile_stock_reservations set profile_id=$1 where id=$2", [id(31), id(1000)]);
    await db.exec("set role authenticated;");
    const result = await client.rpc("get_profile_stock_reservation_ledger_page", { p_page: 1, p_search: "", p_status: "", p_sort: "created_at", p_direction: "desc" });
    assert.equal(result.data.integrity_ok, false);
    assert.doesNotMatch(JSON.stringify(result.data), /SIBLING SECRET/);
    await assert.rejects(load(), /unavailable|incomplete/);
  } finally { await db.exec("rollback;reset role;"); }
});

test("negative or overconsumed source evidence is unavailable and unknown legacy units remain null", async () => {
  await db.exec("reset role;begin;");
  try {
    await db.query("update profile_stock_consumptions set consumed_weight_kg=-1 where id=(select id from profile_stock_consumptions where reservation_id=$1 and company_id=$2 limit 1)", [id(1000), company]);
    await db.exec("set role authenticated;");
    await assert.rejects(load(), /unavailable|incomplete/);
    await db.exec("reset role;");
    await db.query("update profile_stock_consumptions set consumed_weight_kg=9999 where reservation_id=$1 and company_id=$2", [id(1000), company]);
    await db.exec("set role authenticated;");
    await assert.rejects(load(), /unavailable|incomplete/);
  } finally { await db.exec("rollback;reset role;"); }
  await db.exec("begin;");
  try {
    await db.query("update profile_stock_reservations set reserved_pieces=null where id=$1", [id(1001)]);
    await db.exec("set role authenticated;");
    const result = await load({ status: "released" });
    assert.equal(result.rows[0].reserved_pieces, null);
    assert.equal(result.rows[0].released_pieces, null);
  } finally { await db.exec("rollback;reset role;"); }
});

test("consumption entries with altered order, profile or batch provenance cannot produce verified totals", async () => {
  for (const column of ["order_id", "profile_id", "profile_stock_batch_id"]) {
    for (const value of [id(9999), null]) {
      await db.exec("reset role;begin;");
      try {
        await db.query(`update profile_stock_consumptions set ${column}=$1
          where id=(select id from profile_stock_consumptions where reservation_id=$2 and company_id=$3 limit 1)`,
          [value, id(1000), company]);
        await db.exec("set role authenticated;");
        await assert.rejects(load(), /unavailable|incomplete/, `${column}: ${value}`);
      } finally { await db.exec("rollback;reset role;"); }
    }
  }
});

test("the projection executes inside a read-only transaction and rejects invalid raw RPC filters", async () => {
  await db.exec("begin read only;");
  try { assert.equal((await load()).total_count, 601); }
  finally { await db.exec("rollback;"); }
  for (const patch of [{ p_page: 0 }, { p_page: 100001 }, { p_status: "forged" }, { p_sort: "internal_cost" },
    { p_direction: "DROP TABLE" }, { p_search: "x".repeat(101) }]) {
    const result = await client.rpc("get_profile_stock_reservation_ledger_page", { p_page: 1, p_search: "", p_status: "", p_sort: "created_at", p_direction: "desc", ...patch });
    assert.match(result.error.message, /Invalid reservation ledger filters/);
  }
});

test("the client rejects truncated, duplicate, invalid and conflicting payloads without trusting summary-only success", async () => {
  const valid = await load();
  const variants = [null, {}, { ...valid, integrity_ok: false }, { ...valid, rows: valid.rows.slice(1) },
    { ...valid, rows: [valid.rows[0], ...valid.rows.slice(0, 9)] },
    { ...valid, summary: { ...valid.summary, active_count: 999999 } },
    { ...valid, rows: [{ ...valid.rows[0], created_at: "invalid-date" }, ...valid.rows.slice(1)] },
    { ...valid, rows: [{ ...valid.rows[0], consumed_pieces: 1.5 }, ...valid.rows.slice(1)] },
    { ...valid, rows: [{ ...valid.rows[0], open_weight_kg: -1 }, ...valid.rows.slice(1)] }];
  for (const data of variants) {
    await assert.rejects(loadReservationLedgerPage({ rpc: async () => ({ data, error: null }) }, getReservationLedgerOptions({})), /unavailable|incomplete/);
  }
  const data = structuredClone(valid);
  data.rows[0].internal_cost = 99999;
  const safe = await loadReservationLedgerPage({ rpc: async () => ({ data, error: null }) }, getReservationLedgerOptions({}));
  assert.equal(safe.rows[0].internal_cost, undefined);
});

test("URL option normalization bounds invalid input while keeping literal search content", () => {
  const defaults = getReservationLedgerOptions({});
  for (const page of ["0", "-1", "1.5", "Infinity", "NaN", "9007199254740992"]) {
    assert.equal(getReservationLedgerOptions({ page }).page, 1);
  }
  assert.equal(getReservationLedgerOptions({ page: "100001" }).page, 100000);
  assert.deepEqual(getReservationLedgerOptions({ page: ["2"], status: "forged", sort: "internal_cost", direction: "DROP TABLE" }), defaults);
  assert.equal(getReservationLedgerOptions({ q: "  A%_  B  " }).search, "A%_ B");
  assert.equal(getReservationLedgerOptions({ q: "x".repeat(101) }).search.length, 100);
});

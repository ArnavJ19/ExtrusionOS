import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";
import { getBatchAvailableWeightKg, getBatchAvailableLengthM, getBatchAvailablePieces } from "../lib/systems-configurator/inventory-reservation.ts";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), order = id(2), profile = id(3), batch = id(4);
const reservation = id(20), other = id(10), dispatch = id(30);
const directory = new URL("../supabase/migrations/", import.meta.url);
const sources = readdirSync(directory).filter(file => file.endsWith(".sql")).sort()
  .map(file => ({ file, text: readFileSync(new URL(file, directory), "utf8") }));
function latest(name) {
  const source = sources.findLast(entry => entry.text.includes(`create or replace function ${name}(`));
  assert.ok(source, name);
  return sqlDefinition(source.file, name);
}

async function fixture(run) {
  const db = new PGlite();
  try {
    // Current function bodies and quantity guards only; no migration scripts, hosted database or full RLS catalog.
    await db.exec(`create schema auth;create schema private;
      create function auth.uid() returns uuid language sql as $$select '${id(5)}'::uuid$$;
      create table orders(id uuid primary key,company_id uuid);
      create table system_configurations(id uuid primary key,company_id uuid,order_id uuid);
      create table profile_stock_batches(id uuid primary key,company_id uuid,profile_id uuid,
        total_weight_kg numeric(14,3),length_m numeric(14,3),quantity_pieces integer,status text);
      create table profile_stock_reservations(id uuid primary key,company_id uuid,order_id uuid,profile_id uuid,
        profile_stock_batch_id uuid,configuration_id uuid,reserved_weight_kg numeric(14,3),
        reserved_length_m numeric(14,3),reserved_pieces integer,initial_reserved_weight_kg numeric(14,3),
        initial_reserved_length_m numeric(14,3),initial_reserved_pieces integer,status text,released_at timestamptz);
      create table dispatches(id uuid primary key,company_id uuid,order_id uuid);
      create table packing_list_items(id uuid primary key default gen_random_uuid(),company_id uuid,dispatch_id uuid,
        reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,source_kind text,
        net_weight_kg numeric(14,3),net_length_m numeric(14,3),number_of_pieces integer);
      create table profile_stock_consumptions(id uuid primary key default gen_random_uuid(),company_id uuid,
        reservation_id uuid,profile_stock_batch_id uuid,profile_id uuid,order_id uuid,dispatch_id uuid,
        consumed_weight_kg numeric(14,3),consumed_length_m numeric(14,3),consumed_pieces integer,
        notes text,created_by uuid,unique(company_id,dispatch_id,reservation_id));`);
    for (const name of ["private.guard_profile_reservation_capacity", "private.guard_reserved_stock_capacity", "private.consume_dispatch_reservations"]) {
      await db.exec(latest(name));
    }
    await db.exec(`create trigger reservation_capacity before insert or update on profile_stock_reservations
        for each row execute function private.guard_profile_reservation_capacity();
      create trigger batch_capacity before update on profile_stock_batches
        for each row execute function private.guard_reserved_stock_capacity();
      insert into orders values('${order}','${company}');
      insert into profile_stock_batches values('${batch}','${company}','${profile}',50,25,5,'available');
      insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,
        reserved_weight_kg,reserved_length_m,reserved_pieces,status) values
        ('${reservation}','${company}','${order}','${profile}','${batch}',30,15,3,'active'),
        ('${other}','${company}','${order}','${profile}','${batch}',20,10,2,'active');
      insert into dispatches values('${dispatch}','${company}','${order}');
      insert into packing_list_items(company_id,dispatch_id,reservation_id,profile_stock_batch_id,profile_id,
        source_kind,net_weight_kg,net_length_m,number_of_pieces)
        values('${company}','${dispatch}','${reservation}','${batch}','${profile}','reservation',10,5,1);`);
    const consume = dispatchId => db.query("select private.consume_dispatch_reservations($1)", [dispatchId]);
    await consume(dispatch);
    const release = status => db.query("update profile_stock_reservations set status=$1,released_at=now() where id=$2", [status, reservation]);
    const snapshot = async () => ({
      batch: (await db.query("select * from profile_stock_batches where id=$1", [batch])).rows[0],
      reservations: (await db.query("select * from profile_stock_reservations order by id")).rows,
      ledger: (await db.query("select * from profile_stock_consumptions order by id")).rows
    });
    await run({ db, consume, release, snapshot });
  } finally {
    await db.close();
  }
}

for (const status of ["released", "cancelled"]) {
  test(`an exact posted dispatch retry succeeds after the unconsumed hold is ${status}`, () => fixture(async ({ consume, release, snapshot }) => {
    await release(status);
    const before = await snapshot();
    await consume(dispatch);
    await consume(dispatch);
    assert.deepEqual(await snapshot(), before);
    assert.equal(before.ledger.length, 1);
    assert.equal(Number(before.batch.total_weight_kg), 40);
  }));
}

test("partial release frees only the remaining hold and leaves physical stock and posted consumption unchanged", () => fixture(async ({ db, release, snapshot }) => {
  const before = await snapshot();
  await release("released");
  await release("released");
  const after = await snapshot();
  assert.deepEqual(after.batch, before.batch);
  assert.deepEqual(after.ledger, before.ledger);
  const reservations = after.reservations.map(row => ({ ...row,
    consumed_weight_kg: row.id === reservation ? 10 : 0,
    consumed_length_m: row.id === reservation ? 5 : 0, consumed_pieces: row.id === reservation ? 1 : 0
  }));
  assert.equal(getBatchAvailableWeightKg(after.batch, reservations), 20);
  assert.equal(getBatchAvailableLengthM(after.batch, reservations), 10);
  assert.equal(getBatchAvailablePieces(after.batch, reservations), 2);
  await assert.rejects(db.query("update profile_stock_reservations set status='active' where id=$1", [reservation]), /terminal/);
  await db.query(`insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,
    reserved_weight_kg,reserved_length_m,reserved_pieces,status) values($1,$2,$3,$4,$5,20,10,2,'active')`, [id(40), company, order, profile, batch]);
  assert.equal((await snapshot()).ledger.length, 1);
  assert.equal(Number((await snapshot()).batch.total_weight_kg), 40);
}));

test("released holds reject a new dispatch and roll back an earlier source debit in the same attempt", () => fixture(async ({ db, consume, release, snapshot }) => {
  await release("released");
  await db.query("insert into dispatches values($1,$2,$3)", [id(31), company, order]);
  await db.query(`insert into packing_list_items(company_id,dispatch_id,reservation_id,profile_stock_batch_id,profile_id,
    source_kind,net_weight_kg,net_length_m,number_of_pieces) values
    ($1,$2,$3,$5,$6,'reservation',10,5,1),($1,$2,$4,$5,$6,'reservation',10,5,1)`, [company, id(31), other, reservation, batch, profile]);
  const before = await snapshot();
  await assert.rejects(consume(id(31)), /stale|no longer available|active/);
  assert.deepEqual(await snapshot(), before);
}));

test("a retry cannot change the posted kg, metres or pieces even after release", () => fixture(async ({ db, consume, release, snapshot }) => {
  await release("released");
  for (const [column, value] of [["net_weight_kg", 11], ["net_length_m", 6], ["number_of_pieces", 2]]) {
    await db.query(`update packing_list_items set ${column}=$1 where dispatch_id=$2`, [value, dispatch]);
    const before = await snapshot();
    await assert.rejects(consume(dispatch), /immutable/);
    assert.deepEqual(await snapshot(), before);
    await db.query(`update packing_list_items set ${column}=$1 where dispatch_id=$2`, [column === "net_weight_kg" ? 10 : column === "net_length_m" ? 5 : 1, dispatch]);
  }
}));

test("null manifest identity and changed ledger provenance cannot pass as an exact retry", () => fixture(async ({ db, consume, snapshot }) => {
  await db.query("update packing_list_items set profile_id=null where dispatch_id=$1", [dispatch]);
  await assert.rejects(consume(dispatch), /stale|profile|provenance|immutable/);
  await db.query("update packing_list_items set profile_id=$1 where dispatch_id=$2", [profile, dispatch]);
  await db.query("update profile_stock_consumptions set profile_stock_batch_id=$1 where dispatch_id=$2", [id(99), dispatch]);
  const before = await snapshot();
  await assert.rejects(consume(dispatch), /provenance|immutable/);
  assert.deepEqual(await snapshot(), before);
}));

test("consumed holds remain terminal and an exact exhausted reservation retry does not debit again", () => fixture(async ({ db, consume, snapshot }) => {
  await db.query("update packing_list_items set net_weight_kg=30,net_length_m=15,number_of_pieces=3 where dispatch_id=$1", [dispatch]);
  await db.query("delete from profile_stock_consumptions where dispatch_id=$1", [dispatch]);
  await db.query("update profile_stock_batches set total_weight_kg=50,length_m=25,quantity_pieces=5 where id=$1", [batch]);
  await consume(dispatch);
  const before = await snapshot();
  assert.equal(before.reservations.find(row => row.id === reservation).status, "consumed");
  await consume(dispatch);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(db.query("update profile_stock_reservations set status='released' where id=$1", [reservation]), /terminal/);
}));

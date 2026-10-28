import test from "node:test";
import assert from "node:assert/strict";
import { createStockBalanceFixture, bids, bid } from "../scripts/lib/stock-balance-fixture.mjs";

let f;
test.before(async () => { f = await createStockBalanceFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const q = (part) => ({ w: Number(part.weight_kg), p: Number(part.pieces), l: Number(part.length_m) });
/** available = on hand − open − excluded + shortfall, checked in every unit. */
function assertReconciles(data) {
  const [on, open, ex, sf, av] = [data.on_hand, data.open_reserved, data.excluded, data.shortfall, data.available].map(q);
  for (const unit of ["w", "p", "l"]) {
    assert.ok(Math.abs(on[unit] - open[unit] - ex[unit] + sf[unit] - av[unit]) < 1e-9, `${unit} reconciles`);
    assert.ok(av[unit] >= 0, `${unit} availability is never negative`);
  }
  const before = q(data.before_recorded_withdrawals);
  const net = q(data.net_withdrawn);
  for (const unit of ["w", "p", "l"]) assert.ok(Math.abs(before[unit] + net[unit] - on[unit]) < 1e-9, `${unit} withdrawals explain on hand`);
}

test("a batch's availability is on hand minus the open part of active reservations, exactly", async () => {
  const data = await f.explain();
  assert.deepEqual(q(data.on_hand), { w: 800, p: 80, l: 480 });
  assert.deepEqual(q(data.open_reserved), { w: 450, p: 45, l: 270 });
  assert.deepEqual(q(data.available), { w: 350, p: 35, l: 210 });
  assert.equal(data.excluded.reason, null);
  assert.deepEqual(q(data.shortfall), { w: 0, p: 0, l: 0 });
  assertReconciles(data);
});

test("dispatched quantity is not counted twice: R1 shows 150 kg consumed and only 250 kg open", async () => {
  const { reservations } = await f.explain();
  assert.deepEqual(reservations.map((r) => [r.order_number, Number(r.reserved_weight_kg), Number(r.consumed_weight_kg), Number(r.open_weight_kg)]), [
    ["SO-0001", 400, 150, 250], ["SO-0002", 200, 0, 200]
  ]);
  assert.ok(!reservations.some((r) => r.id === bids.r3), "released reservations hold nothing");
});

test("withdrawals list dispatches, dealer debits and cancellation credits with signs, explaining on hand from 1000 kg", async () => {
  const data = await f.explain();
  assert.deepEqual(data.withdrawals.map((w) => [w.kind, Number(w.weight_kg)]), [["dealer_credit", 30], ["dealer_debit", -30], ["dealer_debit", -50], ["dispatch", -150]]);
  assert.equal(data.withdrawals.find((w) => w.kind === "dispatch").reference, "DSP-0001");
  assert.deepEqual(q(data.net_withdrawn), { w: -200, p: -20, l: -120 });
  assert.deepEqual(q(data.before_recorded_withdrawals), { w: 1000, p: 100, l: 600 });
  assert.ok(data.withdrawals.every((w) => !("unit_rate" in w) && !("quoted_line_value" in w)), "commercial rates are never included");
});

test("stock on QC hold is excluded with its reason and is not available", async () => {
  const data = await f.explain(bids.heldBatch);
  assert.equal(data.excluded.reason, "qc_on_hold");
  assert.deepEqual(q(data.excluded), { w: 200, p: 20, l: 120 }, "on hand 300 minus 100 already reserved");
  assert.deepEqual(q(data.available), { w: 0, p: 0, l: 0 });
  assertReconciles(data);
  await f.db.exec(`update profile_stock_batches set qc_status='rejected' where id='${bids.heldBatch}'`);
  assert.equal((await f.explain(bids.heldBatch)).excluded.reason, "qc_rejected");
});

test("over-reserved stock shows the shortfall instead of a negative balance", async () => {
  const data = await f.explain(bids.overBatch);
  assert.deepEqual(q(data.shortfall), { w: 30, p: 3, l: 18 });
  assert.deepEqual(q(data.available), { w: 0, p: 0, l: 0 });
  assertReconciles(data);
});

test("a fully consumed reservation and legacy rows without an initial quantity follow the ledger's basis", async () => {
  await f.db.exec(`update profile_stock_reservations set status='consumed' where id='${bids.r2}';
    insert into profile_stock_reservations values('${bids.rLegacy}','${bids.company}','${bids.batch}','${bids.order2}','active',60,6,36,null,null,null,'2026-10-08T00:00:00Z')`);
  const data = await f.explain();
  assert.deepEqual(q(data.open_reserved), { w: 310, p: 31, l: 186 }, "250 open on R1 + 60 legacy");
  assertReconciles(data);
});

test("over-consumption of one reservation never adds availability back", async () => {
  await f.db.exec(`insert into profile_stock_consumptions(company_id,reservation_id,profile_stock_batch_id,order_id,dispatch_id,consumed_weight_kg,consumed_pieces,consumed_length_m)
    values('${bids.company}','${bids.r2}','${bids.batch}','${bids.order2}','${bids.dispatch1}',250,25,150)`);
  const data = await f.explain();
  assert.equal(Number(data.reservations.find((r) => r.id === bids.r2).open_weight_kg), 0);
  assertReconciles(data);
});

test("the list shows unsent batches with availability, filters and literal search, 10 per page", async () => {
  const all = await f.command("balance.list", {});
  assert.deepEqual(all.rows.map((r) => r.batch.bundle_number), ["D-1", "B-300", "B-200", "B-100"], "dispatched and foreign batches are excluded");
  assert.deepEqual((await f.command("balance.list", { filter: "reservable" })).rows.map((r) => r.batch.bundle_number), ["D-1", "B-100"]);
  assert.deepEqual((await f.command("balance.list", { filter: "held" })).rows.map((r) => r.batch.bundle_number), ["B-200"]);
  assert.deepEqual((await f.command("balance.list", { filter: "over_reserved" })).rows.map((r) => r.batch.bundle_number), ["B-300"]);
  assert.deepEqual((await f.command("balance.list", { search: "rack b" })).rows.map((r) => r.batch.bundle_number), ["B-300", "B-200"]);
  assert.equal((await f.command("balance.list", { search: "_" })).total_count, 0, "pattern characters are literal");
  const values = Array.from({ length: 12 }, (_, i) => `('${bid(900 + i)}','${bids.company}','${bids.profile}','X-${i}','mill','Rack Z','available','released','opening_balance',null,now(),null,10,1,6)`).join(",");
  await f.db.exec(`insert into profile_stock_batches values ${values}`);
  const page1 = await f.command("balance.list", { page: 1 });
  assert.equal(page1.total_count, 16);
  assert.equal(page1.rows.length, 10);
  assert.equal((await f.command("balance.list", { page: 2 })).rows.length, 6);
  await assert.rejects(f.command("balance.list", { filter: "everything" }), /Invalid stock balance search/);
});

test("dealers explain only their own batches, without other parties' customer names", async () => {
  const own = await f.explain(bids.dealerBatch, bids.dealer);
  assert.equal(own.batch.dealer_owned, true);
  assertReconciles(own);
  await assert.rejects(f.explain(bids.batch, bids.dealer), /Stock batch is unavailable/);
  await assert.rejects(f.explain(bids.dealerBatch, bids.otherDealerUser), /Stock batch is unavailable/);
  assert.deepEqual((await f.command("balance.list", {}, bids.dealer)).rows.map((r) => r.batch.bundle_number), ["D-1"]);
  await f.db.exec(`insert into profile_stock_reservations values('${bid(990)}','${bids.company}','${bids.dealerBatch}','${bids.order1}','active',9,1,5.4,9,1,5.4,now())`);
  const withReservation = await f.explain(bids.dealerBatch, bids.dealer);
  assert.equal(withReservation.reservations[0].customer_name, undefined);
  assert.equal(withReservation.reservations[0].order_id, undefined);
});

test("roles outside the stock ledger, other companies and anonymous callers are refused", async () => {
  for (const actor of [bids.sales, bids.viewer]) await assert.rejects(f.explain(bids.batch, actor), /not permitted/);
  assert.ok((await f.explain(bids.batch, bids.inventory)).available);
  await assert.rejects(f.explain(bids.batch, bids.foreign), /Stock batch is unavailable/);
  await assert.rejects(f.explain(bids.foreignBatch), /Stock batch is unavailable/);
  await assert.rejects(f.asUser("select public.profile_stock_balance_command('balance.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser("select private.profile_stock_balance($1,$2)", [bids.otherCompany, bids.foreignBatch]), /permission denied/);
  await assert.rejects(f.command("balance.delete", {}), /not permitted/);
});

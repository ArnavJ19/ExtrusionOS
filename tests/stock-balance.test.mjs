import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { balanceCommandSchema, balanceExplanationSchema, balanceListSchema, canExplainStock, reconciliationProblem } from "../lib/inventory/stock-balance.ts";
import { buildProfileReservationStatus, getBatchAvailableWeightKg, getBatchAvailablePieces, isReservableBatch } from "../lib/systems-configurator/inventory-reservation.ts";
import { createStockBalanceFixture, bids } from "../scripts/lib/stock-balance-fixture.mjs";

const qty = (weight_kg, pieces, length_m) => ({ weight_kg, pieces, length_m });

test("readers match the reservation ledger plus dealer users for their own stock", () => {
  for (const role of ["owner", "admin", "production_manager", "production", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch", "dealer_admin", "dealer_staff"]) assert.ok(canExplainStock(role), role);
  for (const role of ["sales", "accounts", "viewer", "quality"]) assert.ok(!canExplainStock(role), role);
});

test("the reconciliation check catches any component that does not add up, in thousandths", () => {
  const ok = { on_hand: qty(800, 80, 480), open_reserved: qty(450, 45, 270), excluded: qty(0, 0, 0), shortfall: qty(0, 0, 0), available: qty(350, 35, 210) };
  assert.equal(reconciliationProblem(ok), null);
  assert.match(reconciliationProblem({ ...ok, available: qty(350.002, 35, 210) }), /weight kg explanation does not reconcile/);
  assert.match(reconciliationProblem({ ...ok, available: qty(350, 36, 210) }), /pieces/);
  assert.match(reconciliationProblem({ ...ok, open_reserved: qty(900, 90, 540), available: qty(-100, -10, -60) }), /cannot be negative/);
  assert.equal(reconciliationProblem({ ...ok, available: qty(350.0004, 35, 210) }), null, "sub-gram float noise is tolerated");
  assert.match(reconciliationProblem({ ...ok, net_withdrawn: qty(-200, -20, -120), before_recorded_withdrawals: qty(999, 100, 600) }), /withdrawals do not explain/);
});

test("command schema bounds search, filters and requires a batch id", () => {
  assert.equal(balanceCommandSchema.safeParse({ command: "balance.explain", batch_id: "x" }).success, false);
  assert.equal(balanceCommandSchema.safeParse({ command: "balance.list", filter: "all" }).success, false);
  assert.equal(balanceCommandSchema.safeParse({ command: "balance.list", search: "x".repeat(81) }).success, false);
  assert.deepEqual(balanceCommandSchema.parse({ command: "balance.list" }), { command: "balance.list", page: 1, search: "", filter: "in_stock" });
});

test("QC-held or sent batches are not reservable, so the configurator no longer reports stock it cannot reserve", () => {
  assert.equal(isReservableBatch({ status: "available", qc_status: "released" }), true);
  assert.equal(isReservableBatch({ status: "reserved", qc_status: "not_required" }), true);
  assert.equal(isReservableBatch({ status: "available", qc_status: "on_hold" }), false);
  assert.equal(isReservableBatch({ status: "available", qc_status: "rejected" }), false);
  assert.equal(isReservableBatch({ status: "dispatched", qc_status: "released" }), false);
  assert.equal(isReservableBatch({ status: "available" }), true, "rows read without the QC column keep the previous behaviour");
  const requirement = { profileId: "p", profileCode: "EX-101", profileName: "", requiredWeightKg: 200, requiredLengthM: 0 };
  const [status] = buildProfileReservationStatus([requirement], [{ id: "b", profile_id: "p", status: "available", qc_status: "on_hold", total_weight_kg: 300, length_m: 180 }]);
  assert.equal(status.availableWeightKg, 0);
  assert.equal(status.ready, false);
});

let f;
test.before(async () => { f = await createStockBalanceFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database explanations and lists parse and reconcile with the app's schema", async () => {
  for (const batch of [bids.batch, bids.heldBatch, bids.overBatch, bids.dealerBatch]) {
    const parsed = balanceExplanationSchema.safeParse(await f.explain(batch));
    assert.ok(parsed.success, `${batch}: ${parsed.success ? "" : parsed.error.message}`);
  }
  for (const filter of ["in_stock", "reservable", "held", "over_reserved"]) assert.ok(balanceListSchema.safeParse(await f.command("balance.list", { filter })).success, filter);
  const dealerView = balanceExplanationSchema.safeParse(await f.explain(bids.dealerBatch, bids.dealer));
  assert.ok(dealerView.success);
});

test("the database and the configurator's availability helpers agree for a released batch", async () => {
  const sql = await f.explain(bids.batch);
  const reservations = (await f.db.query(`select r.id, r.profile_stock_batch_id, r.status, r.reserved_weight_kg::float8 reserved_weight_kg, r.reserved_pieces,
      coalesce((select sum(consumed_weight_kg) from profile_stock_consumptions c where c.reservation_id=r.id),0)::float8 consumed_weight_kg,
      coalesce((select sum(consumed_pieces) from profile_stock_consumptions c where c.reservation_id=r.id),0)::int consumed_pieces
    from profile_stock_reservations r`)).rows;
  const batch = { id: bids.batch, total_weight_kg: 800, quantity_pieces: 80 };
  assert.equal(getBatchAvailableWeightKg(batch, reservations), Number(sql.available.weight_kg));
  assert.equal(getBatchAvailablePieces(batch, reservations), Number(sql.available.pieces));
});

test("the pages gate on the same readers and refuse to show an explanation that does not reconcile", () => {
  for (const page of ["app/(dashboard)/inventory/stock-balances/page.tsx", "app/(dashboard)/inventory/stock-balances/[id]/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /if \(!canExplainStock\(context\.role\)\) redirect\("\/inventory"\)/, page);
  }
  assert.match(readFileSync("app/(dashboard)/inventory/stock-balances/[id]/page.tsx", "utf8"), /did not reconcile, so it is not shown/);
  assert.match(readFileSync("lib/auth/route-permissions.ts", "utf8"), /prefix: "\/inventory\/stock-balances", roles: \[[^\]]*"dispatch", "dealer_admin", "dealer_staff"\]/);
});

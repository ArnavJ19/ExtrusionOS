import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBilletWeightKg,
  calculateTotalBilletWeightKg,
  inchesToMm,
  calculateRequiredBilletCount,
  calculateFoundryFurnaceMix
} from "../lib/calculations/foundry.ts";
import {
  getBatchAvailableWeightKg,
  buildProfileReservationStatus,
  groupProfileReservationRequirements
} from "../lib/systems-configurator/inventory-reservation.ts";

test("billet weight is the cylinder volume times aluminium density", () => {
  // r = 0.1 m, L = 1 m -> pi*0.01*1 = 0.0314159 m^3 * 2700 = 84.823 kg
  assert.equal(calculateBilletWeightKg(1000, 200), 84.823);
  assert.equal(calculateTotalBilletWeightKg(1000, 200, 3), 254.469);
  assert.equal(calculateBilletWeightKg(0, 200), 0);
  assert.equal(calculateBilletWeightKg(1000, 0), 0);
});

test("inches to mm uses the exact 25.4 factor", () => {
  assert.equal(inchesToMm(7), 177.8);
  assert.equal(inchesToMm(0), 0);
});

test("required billet count grosses up for extrusion efficiency and rounds up", () => {
  // need 1000 kg good output at 80% efficiency -> 1250 kg billet / 100 kg each -> 13 billets
  assert.equal(calculateRequiredBilletCount(1000, 100, 80), 13);
  assert.equal(calculateRequiredBilletCount(0, 100, 80), 0);
  assert.equal(calculateRequiredBilletCount(1000, 0, 80), 0);
  assert.equal(calculateRequiredBilletCount(1000, 100, 0), 0);
});

test("furnace mix conserves the charge and never exceeds 100 percent", () => {
  const valid = calculateFoundryFurnaceMix(800, 80, 30, 70);
  assert.equal(valid.requiredFurnaceChargeKg, 1000); // 800 / 0.8
  assert.equal(valid.scrapAluminiumKg, 300);
  assert.equal(valid.externalAluminiumKg, 700);
  assert.equal(valid.scrapAluminiumKg + valid.externalAluminiumKg, valid.requiredFurnaceChargeKg);

  // Inconsistent input (30 + 100 = 130%) is normalized, never melts 130% of the charge.
  const bad = calculateFoundryFurnaceMix(800, 80, 30, 100);
  assert.ok(bad.scrapAluminiumKg + bad.externalAluminiumKg <= bad.requiredFurnaceChargeKg + 0.001);
  assert.ok(bad.scrapAluminiumKg <= bad.requiredFurnaceChargeKg);
  assert.ok(bad.externalAluminiumKg <= bad.requiredFurnaceChargeKg);

  assert.deepEqual(calculateFoundryFurnaceMix(0, 80, 30, 70), { requiredFurnaceChargeKg: 0, scrapAluminiumKg: 0, externalAluminiumKg: 0 });
});

test("batch available weight nets out only ACTIVE reservations on that batch", () => {
  const batch = { id: "b1", total_weight_kg: 1000 };
  const reservations = [
    { profile_stock_batch_id: "b1", status: "active", reserved_weight_kg: 300 },
    { profile_stock_batch_id: "b1", status: "consumed", reserved_weight_kg: 200 },
    { profile_stock_batch_id: "b2", status: "active", reserved_weight_kg: 500 }
  ];
  // Only the 300 kg active reservation on b1 counts as a hold.
  assert.equal(getBatchAvailableWeightKg(batch, reservations), 700);
});

test("profile reservation status computes available, shortage and readiness", () => {
  const requirements = groupProfileReservationRequirements([
    { profile_id: "p1", profile_code: "SW-OF", total_weight_kg: 300, total_length_m: 120 },
    { profile_id: "p1", profile_code: "SW-OF", total_weight_kg: 200, total_length_m: 80 }
  ]);
  assert.equal(requirements[0].requiredWeightKg, 500);

  const ready = buildProfileReservationStatus(
    requirements,
    [{ profile_id: "p1", status: "available", total_weight_kg: 1000 }],
    [{ profile_id: "p1", status: "active", reserved_weight_kg: 300 }]
  )[0];
  assert.equal(ready.totalStockWeightKg, 1000);
  assert.equal(ready.reservedWeightKg, 300);
  assert.equal(ready.availableWeightKg, 700); // 1000 - 300 held
  assert.equal(ready.shortageKg, 0); // 700 available >= 500 required
  assert.equal(ready.ready, true);

  const short = buildProfileReservationStatus(
    [{ profileId: "p1", profileCode: "SW-OF", profileName: "", requiredWeightKg: 900, requiredLengthM: 300 }],
    [{ profile_id: "p1", status: "available", total_weight_kg: 1000 }],
    [{ profile_id: "p1", status: "active", reserved_weight_kg: 300 }]
  )[0];
  assert.equal(short.availableWeightKg, 700);
  assert.equal(short.shortageKg, 200); // needs 900, only 700 free
  assert.equal(short.ready, false);
});

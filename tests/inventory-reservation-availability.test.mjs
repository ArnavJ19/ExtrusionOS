import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProfileReservationStatus,
  getBatchReservationAllocation,
  getBatchAvailableLengthM,
  getBatchAvailablePieces,
  getBatchAvailableWeightKg
} from "../lib/systems-configurator/inventory-reservation.ts";

describe("reservation availability after partial dispatch", () => {
  it("requires enough usable metres as well as kilograms for BOM readiness", () => {
    const requirement = { profileId: "p1", profileCode: "P1", profileName: "Profile", requiredWeightKg: 20, requiredLengthM: 10 };
    const batches = [
      { id: "available", profile_id: "p1", total_weight_kg: 30, length_m: 5, status: "available" },
      { id: "hold", profile_id: "p1", total_weight_kg: 999, length_m: 999, status: "quality_hold" }
    ];
    const [status] = buildProfileReservationStatus([requirement], batches, []);
    assert.equal(status.availableWeightKg, 30);
    assert.equal(status.availableLengthM, 5);
    assert.equal(status.ready, false);
  });
  it("subtracts consumed kg, metres, and pieces from active holds", () => {
    const batch = { id: "batch-1", profile_id: "profile-1", total_weight_kg: 40, length_m: 20, quantity_pieces: 4, status: "reserved" };
    const reservation = {
      id: "reservation-1", profile_stock_batch_id: "batch-1", profile_id: "profile-1", status: "active",
      reserved_weight_kg: 30, reserved_length_m: 15, reserved_pieces: 3,
      consumed_weight_kg: 10, consumed_length_m: 5, consumed_pieces: 1
    };

    assert.equal(getBatchAvailableWeightKg(batch, [reservation]), 20);
    assert.equal(getBatchAvailableLengthM(batch, [reservation]), 10);
    assert.equal(getBatchAvailablePieces(batch, [reservation]), 2);
    assert.deepEqual(buildProfileReservationStatus([
      { profileId: "profile-1", profileCode: "P-1", profileName: "Profile", requiredWeightKg: 20, requiredLengthM: 10 }
    ], [batch], [reservation]).map(({ availableWeightKg, availableLengthM, reservedWeightKg, reservedLengthM, ready }) => ({
      availableWeightKg, availableLengthM, reservedWeightKg, reservedLengthM, ready
    })), [{ availableWeightKg: 20, availableLengthM: 10, reservedWeightKg: 20, reservedLengthM: 10, ready: true }]);
  });

  it("allocates exact whole-piece kg and metres for new holds", () => {
    const largeBatch = { id: "large", total_weight_kg: 400, length_m: 200, quantity_pieces: 40 };
    assert.deepEqual(getBatchReservationAllocation(largeBatch, 40, 100, 50), { pieces: 10, weightKg: 100, lengthM: 50 });

    const remainderBatch = { id: "remainder", total_weight_kg: 40, length_m: 20, quantity_pieces: 4 };
    const remainingReservation = {
      id: "hold", profile_stock_batch_id: "remainder", status: "active",
      reserved_weight_kg: 30, reserved_length_m: 15, reserved_pieces: 3,
      consumed_weight_kg: 10, consumed_length_m: 5, consumed_pieces: 1,
    };
    assert.equal(getBatchAvailableWeightKg(remainderBatch, [remainingReservation]), 20);
    assert.equal(getBatchAvailableLengthM(remainderBatch, [remainingReservation]), 10);
    const freePieces = getBatchAvailablePieces(remainderBatch, [remainingReservation]);
    assert.equal(freePieces, 2);
    assert.deepEqual(getBatchReservationAllocation(remainderBatch, freePieces, 10, 10), { pieces: 2, weightKg: 20, lengthM: 10 });
  });
});

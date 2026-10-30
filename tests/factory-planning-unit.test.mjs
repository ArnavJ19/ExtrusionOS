import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFactoryDeliveryProposal,
  factoryDeliveryDataSchema,
  factoryMaintenanceBlockInputSchema,
  factoryShiftCapacityInputSchema,
  factoryVehicleLoadInputSchema,
  factoryVehicleLoadWeight,
  inspectProposedScheduleMove
} from "../lib/workflow/factory-planning.ts";
import { cid } from "../scripts/lib/factory-planning-fixture.mjs";

const today = "2026-10-29";
const weekday = day => new Date(`${day}T00:00:00.000Z`).getUTCDay() || 7;

function deliveryData(patch = {}) {
  const line = {
    order_item_id: cid(901), order_id: cid(902), order_number: "ORD-26-1", customer_name: "Fabricator A", order_stage: "extrusion_planned",
    line_label: "AL-01 · mill finish", profile_code: "AL-01", ordered_kg: 200, from_stock_kg: 0, produced_kg: 0, planned_open_kg: 200,
    packed_kg: 0, dispatched_kg: 0, line_required_date: null, effective_date: null, effective_priority: "normal", order_closed: false
  };
  return factoryDeliveryDataSchema.parse({
    company_id: cid(1), today,
    order: { id: cid(902), order_number: "ORD-26-1", current_stage: "extrusion_planned", expected_dispatch_date: "2026-11-12", billets_short: 0, billet_allocation_status: "complete" },
    lines: [line], jobs: [{ id: cid(903), job_number: "PJ-1", source_line_id: cid(901), status: "planned", planned_quantity_kg: 200, actual_quantity_kg: 0, machine_id: cid(904), finishing_type: "powder" }],
    slots: [{ id: cid(905), production_job_id: cid(903), machine_id: cid(904), planned_start_at: "2026-10-30T09:00:00+05:30", planned_end_at: "2026-10-30T11:00:00+05:30", shift: "Day", sequence_number: 0, capacity_kg: 200, status: "scheduled" }],
    shift_capacities: [{ id: cid(906), machine_id: cid(904), weekday: weekday("2026-10-30"), shift_name: "Day", starts_local: "08:00", ends_local: "20:00", capacity_kg: 500 }],
    maintenance_blocks: [], finishing_lead_times: [{ finishing_type: "powder", lead_days: 3 }],
    eligible_stock_kg: 0, eligible_bundle_count: 0, unlinked_packed_kg: 0, active_load_dates: [], ...patch
  });
}

test("factory planning inputs reject extra fields, non-finite kg and invalid times", () => {
  assert.equal(factoryShiftCapacityInputSchema.safeParse({ machine_id: cid(1), weekday: 1, shift_name: "Day", starts_local: "08:00", ends_local: "20:00", capacity_kg: 500 }).success, true);
  assert.equal(factoryShiftCapacityInputSchema.safeParse({ machine_id: cid(1), weekday: 1, shift_name: "Day", starts_local: "08:00", ends_local: "20:00", capacity_kg: "Infinity" }).success, false);
  assert.equal(factoryShiftCapacityInputSchema.safeParse({ machine_id: cid(1), weekday: 1, shift_name: "Day", starts_local: "24:00", ends_local: "20:00", capacity_kg: 500 }).success, false);
  assert.equal(factoryMaintenanceBlockInputSchema.safeParse({ id: cid(2), machine_id: cid(1), starts_at: "2026-10-30T10:00:00+05:30", ends_at: "2026-10-30T09:00:00+05:30", reason: "Service" }).success, false);
  assert.equal(factoryMaintenanceBlockInputSchema.safeParse({ id: cid(2), machine_id: cid(1), starts_at: "2026-10-30T09:00:00+05:30", ends_at: "2026-10-30T10:00:00+05:30", reason: "Service", company_id: cid(3) }).success, false);
});

test("reviewed schedule inspection recognizes an overnight shift and blocks maintenance and overlap", () => {
  const data = deliveryData({
    slots: [],
    shift_capacities: [{ id: cid(906), machine_id: cid(904), weekday: weekday("2026-10-29"), shift_name: "Night", starts_local: "22:00", ends_local: "06:00", capacity_kg: 300 }]
  });
  const input = { production_job_id: cid(903), slot_id: null, machine_id: cid(904), planned_start_at: "2026-10-30T01:00:00+05:30", planned_end_at: "2026-10-30T02:00:00+05:30", shift: "Night", capacity_kg: 100 };
  assert.deepEqual(inspectProposedScheduleMove(data, input), []);
  const blocked = factoryDeliveryDataSchema.parse({ ...data, maintenance_blocks: [{ id: cid(907), machine_id: cid(904), starts_at: "2026-10-30T01:30:00+05:30", ends_at: "2026-10-30T03:00:00+05:30", reason: "Repair", status: "planned" }] });
  assert.equal(inspectProposedScheduleMove(blocked, input).some(issue => issue.code === "maintenance"), true);
});

test("delivery proposal separates covered stock, full planned demand and missing finishing assumptions", () => {
  const scheduled = buildFactoryDeliveryProposal(deliveryData({ active_load_dates: ["2026-11-04", "2026-11-04"] }));
  assert.equal(scheduled.proposalDate, "2026-11-04");
  assert.equal(scheduled.missing.length, 1);
  assert.match(scheduled.assumptions.join(" "), /forecast, not an approved customer commitment/);

  const stock = buildFactoryDeliveryProposal(deliveryData({ eligible_stock_kg: 220, eligible_bundle_count: 4 }));
  assert.equal(stock.proposalDate, today);
  assert.equal(stock.eligibleStockKg, 220);

  const packed = buildFactoryDeliveryProposal(deliveryData({ lines: [{ ...deliveryData().lines[0], packed_kg: 200 }] }));
  assert.equal(packed.proposalDate, today);
  assert.match(packed.assumptions.join(" "), /already packed and awaiting confirmed departure/);

  const unlinkedPacked = buildFactoryDeliveryProposal(deliveryData({
    lines: [{ ...deliveryData().lines[0], packed_kg: 200 }], unlinked_packed_kg: 0.5
  }));
  assert.equal(unlinkedPacked.proposalDate, null);
  assert.match(unlinkedPacked.missing.join(" "), /packed goods has no verified order-line relationship/);

  const uncovered = buildFactoryDeliveryProposal(deliveryData({
    lines: [{ ...deliveryData().lines[0], ordered_kg: 300 }]
  }));
  assert.equal(uncovered.proposalDate, null);
  assert.match(uncovered.missing.join(" "), /no production job yet/);

  const noFinishing = buildFactoryDeliveryProposal(deliveryData({ finishing_lead_times: [] }));
  assert.equal(noFinishing.proposalDate, null);
  assert.match(noFinishing.missing.join(" "), /No finishing lead time/);
});

test("vehicle-load review inputs reject duplicates and the measured weight total is stable", () => {
  const payload = { request_id: cid(11), load_id: null, expected_version: 0, vehicle_id: cid(12), vehicle_fingerprint: "a".repeat(32), load_date: today, bundles: [{ id: cid(13), fingerprint: "b".repeat(32) }] };
  assert.equal(factoryVehicleLoadInputSchema.safeParse(payload).success, true);
  assert.equal(factoryVehicleLoadInputSchema.safeParse({ ...payload, bundles: [payload.bundles[0], payload.bundles[0]] }).success, false);
  assert.equal(factoryVehicleLoadWeight([{ net_weight_kg: 1.235 }, { net_weight_kg: 2.765 }]), 4);
});

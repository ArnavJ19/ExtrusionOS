import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionJobRemarks, getProductionHandoffReadiness, groupProfileCutsForProduction } from "../lib/systems-configurator/production-handoff.ts";

test("production handoff groups profile cuts into planned jobs", () => {
  const groups = groupProfileCutsForProduction([
    { profile_id: "p2", profile_code: "B", profile_name: "Bottom", total_weight_kg: 3.25, total_length_m: 8 },
    { profile_id: "p1", profile_code: "A", profile_name: "Top", total_weight_kg: 2.5, total_length_m: 5 },
    { profile_id: "p1", profile_code: "A", profile_name: "Top", total_weight_kg: 1.25, total_length_m: 2.5 },
    { profile_id: null, profile_code: "X", total_weight_kg: 9, total_length_m: 9 },
    { profile_id: "p3", profile_code: "C", profile_name: "Zero", total_weight_kg: 0, total_length_m: 4 }
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.profileCode), ["A", "B"]);
  assert.equal(groups[0].plannedQuantityKg, 3.75);
  assert.equal(groups[0].plannedMeters, 7.5);
});

test("production handoff readiness blocks incomplete configurations", () => {
  const groups = [{ profileId: "p1", profileCode: "A", profileName: "Top", plannedQuantityKg: 3, plannedMeters: 7 }];

  assert.match(getProductionHandoffReadiness({ status: "draft", customer_id: "c1" }, groups).reason ?? "", /Calculate/);
  assert.match(getProductionHandoffReadiness({ status: "calculated", customer_id: null }, groups).reason ?? "", /customer/);
  assert.match(getProductionHandoffReadiness({ status: "calculated", customer_id: "c1" }, []).reason ?? "", /profile cut/);
  assert.match(getProductionHandoffReadiness({ status: "calculated", customer_id: "c1", order_id: "o1" }, groups, 1).reason ?? "", /already exists/);
  assert.equal(getProductionHandoffReadiness({ status: "quoted", customer_id: "c1" }, groups).ready, true);
});

test("production handoff remarks keep configuration traceability", () => {
  assert.equal(buildProductionJobRemarks("SC-2026-0001", "W01"), "System configuration SC-2026-0001 / W01");
});

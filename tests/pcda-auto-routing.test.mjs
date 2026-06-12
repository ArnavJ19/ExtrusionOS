import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveProductionRoute, getFinishStage } from "../lib/workflow/pcda/auto-routing.ts";

describe("Auto-routing derivation", () => {
  it("always includes extrusion, quenching, cutting, QC, packing, dispatch", () => {
    const route = deriveProductionRoute({});
    const stages = route.map((s) => s.stage_name);
    assert.ok(stages.includes("Extrusion"));
    assert.ok(stages.includes("Quenching"));
    assert.ok(stages.includes("Cutting"));
    assert.ok(stages.includes("Quality Inspection"));
    assert.ok(stages.includes("Packing"));
    assert.ok(stages.includes("Dispatch"));
  });

  it("includes stretching when stretching_requirement is set", () => {
    const route = deriveProductionRoute({ stretching_requirement: "Required" });
    assert.ok(route.some((s) => s.stage_name === "Stretching"));
  });

  it("does not include stretching when requirement is null", () => {
    const route = deriveProductionRoute({ stretching_requirement: null });
    assert.ok(!route.some((s) => s.stage_name === "Stretching"));
  });

  it("includes aging when aging_requirement is set", () => {
    const route = deriveProductionRoute({ aging_requirement: "T6 – 6 hours" });
    assert.ok(route.some((s) => s.stage_name === "Aging"));
  });

  it("includes powder coating when allowed", () => {
    const route = deriveProductionRoute({ powder_coating_allowed: true });
    assert.ok(route.some((s) => s.stage_name === "Powder Coating"));
  });

  it("includes anodizing when allowed", () => {
    const route = deriveProductionRoute({ anodizing_allowed: true });
    assert.ok(route.some((s) => s.stage_name === "Anodizing"));
  });

  it("does not include surface treatments when not allowed", () => {
    const route = deriveProductionRoute({ powder_coating_allowed: false, anodizing_allowed: false });
    assert.ok(!route.some((s) => s.stage_name === "Powder Coating"));
    assert.ok(!route.some((s) => s.stage_name === "Anodizing"));
  });

  it("is deterministic — same inputs produce same outputs", () => {
    const input = { powder_coating_allowed: true, aging_requirement: "T5", stretching_requirement: "Yes" };
    const a = deriveProductionRoute(input);
    const b = deriveProductionRoute(input);
    assert.deepEqual(a, b);
  });

  it("maintains correct order: extrusion before cutting before QC", () => {
    const route = deriveProductionRoute({ powder_coating_allowed: true, aging_requirement: "T6" });
    const stages = route.map((s) => s.stage_name);
    assert.ok(stages.indexOf("Extrusion") < stages.indexOf("Cutting"));
    assert.ok(stages.indexOf("Cutting") < stages.indexOf("Quality Inspection"));
    assert.ok(stages.indexOf("Quality Inspection") < stages.indexOf("Packing"));
  });
});

describe("getFinishStage", () => {
  it("maps powder_coating to Powder Coating", () => {
    assert.equal(getFinishStage("powder_coating"), "Powder Coating");
  });

  it("maps anodizing variants to Anodizing", () => {
    assert.equal(getFinishStage("anodizing"), "Anodizing");
    assert.equal(getFinishStage("anodized_silver"), "Anodizing");
  });

  it("maps mill_finish to null (no treatment)", () => {
    assert.equal(getFinishStage("mill_finish"), null);
  });

  it("maps wood_finish to Wood Finish", () => {
    assert.equal(getFinishStage("wood_finish"), "Wood Finish");
  });

  it("maps unknown to Special Finish", () => {
    assert.equal(getFinishStage("custom_xyz"), "Special Finish");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { getConfigurationDataReadiness, getLibraryReadiness, getTemplateHardwareCategories, getTemplateRequiredRoles } from "../lib/systems-configurator/data-readiness.ts";

const template = {
  formula_json: {
    requiredComponents: ["outer_frame_top", "outer_frame_bottom"],
    profileRules: [{ componentRole: "shutter_vertical", quantityFormula: "2 * Q", lengthFormula: "H" }],
    hardwareRules: { roller: { quantityFormula: "2 * shutter_count * Q" }, lock: { quantityFormula: "1 * Q" } }
  }
};

const profile = (role, weight = 1.2) => ({ id: role, series_id: "series-1", profile_id: `profile-${role}`, component_role: role, display_name: role, is_active: true, aluminium_profiles: { profile_code: role.toUpperCase(), section_weight_kg_per_m: weight } });

test("data readiness extracts template requirements", () => {
  assert.deepEqual(getTemplateRequiredRoles(template), ["outer_frame_top", "outer_frame_bottom", "shutter_vertical"]);
  assert.deepEqual(getTemplateHardwareCategories(template), ["roller", "lock"]);
});

test("configuration data readiness blocks missing required profile mappings", () => {
  const summary = getConfigurationDataReadiness({
    seriesId: "series-1",
    template,
    systemProfiles: [profile("outer_frame_top")],
    hardwareItems: [{ id: "roller", hardware_category: "roller", item_code: "ROLLER", default_rate: 10, is_active: true }],
    glassItems: [{ id: "glass-1", glass_code: "GL", rate_per_sqft: 100, rate_per_sqm: 0, is_active: true }],
    finishOptions: [{ id: "finish-1", finish_code: "PC", rate: 50, is_active: true }],
    glassId: "glass-1",
    finishId: "finish-1"
  });

  assert.equal(summary.status, "critical");
  assert.equal(summary.issues.some((issue) => issue.code === "missing_required_profile_role"), true);
  assert.equal(summary.issues.some((issue) => issue.code === "missing_hardware_category"), true);
});

test("configuration data readiness reports ready complete setup", () => {
  const summary = getConfigurationDataReadiness({
    seriesId: "series-1",
    template,
    systemProfiles: [profile("outer_frame_top"), profile("outer_frame_bottom"), profile("shutter_vertical")],
    hardwareItems: [{ id: "roller", hardware_category: "roller", item_code: "ROLLER", default_rate: 10, is_active: true }, { id: "lock", hardware_category: "lock", item_code: "LOCK", default_rate: 20, is_active: true }],
    glassItems: [{ id: "glass-1", glass_code: "GL", rate_per_sqft: 100, rate_per_sqm: 0, is_active: true }],
    finishOptions: [{ id: "finish-1", finish_code: "PC", rate: 50, is_active: true }],
    glassId: "glass-1",
    finishId: "finish-1"
  });

  assert.equal(summary.status, "ready");
  assert.equal(summary.issues.length, 0);
});

test("library readiness highlights missing rates without blocking setup", () => {
  const summary = getLibraryReadiness({
    systemProfiles: [profile("outer_frame_top", 0)],
    hardwareItems: [{ id: "roller", hardware_category: "roller", item_code: "ROLLER", default_rate: 0, is_active: true }],
    glassItems: [{ id: "glass-1", glass_code: "GL", rate_per_sqft: 0, rate_per_sqm: 0, is_active: true }],
    finishOptions: [{ id: "finish-1", finish_code: "PC", rate: 0, is_active: true }]
  });

  assert.equal(summary.status, "warning");
  assert.equal(summary.issues.filter((issue) => issue.area === "rates").length >= 3, true);
});
